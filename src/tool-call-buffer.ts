import * as vscode from "vscode";
import type { Json } from "./types";
import { tryParseJSONObject } from "./json-utils";

/**
 * Active text-embedded tool call being assembled from control tokens.
 */
export interface TextToolCallState {
  name?: string;
  index?: number;
  argBuffer: string;
  emitted?: boolean;
}

/**
 * Encapsulates all tool call buffering, deduplication, and parsing state
 * for a single streaming request. Create a new instance per request.
 */
export class ToolCallStateMachine {
  /** Buffer for assembling streamed tool calls by index. */
  private _toolCallBuffers: Map<
    number,
    { id?: string; name?: string; args: string }
  > = new Map();

  /** Indices for which a tool call has been fully emitted. */
  private _completedToolCallIndices = new Set<number>();

  /** Track if we emitted any assistant text before seeing tool calls */
  hasEmittedAssistantText = false;

  /** Track if we emitted the begin-tool-calls whitespace hint */
  private _emittedBeginToolCallsHint = false;

  /** Buffer for text-embedded tool call token parsing */
  private _textToolParserBuffer = "";

  /** Active text-embedded tool call being assembled */
  private _textToolActive: TextToolCallState | undefined;

  /** Deduplicate tool calls parsed from text and structured deltas */
  private _emittedTextToolCallKeys = new Set<string>();
  private _emittedTextToolCallIds = new Set<string>();

  /**
   * Reset all state. Called at the end of stream processing.
   */
  reset(): void {
    this._toolCallBuffers.clear();
    this._completedToolCallIndices.clear();
    this.hasEmittedAssistantText = false;
    this._emittedBeginToolCallsHint = false;
    this._textToolParserBuffer = "";
    this._textToolActive = undefined;
    this._emittedTextToolCallKeys.clear();
    this._emittedTextToolCallIds.clear();
  }

  /**
   * Process structured tool call deltas from the streaming response.
   */
  processStructuredToolCalls(
    toolCalls: Array<{
      id?: string;
      index?: number;
      function?: { name?: string; arguments?: string };
    }>,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>
  ): void {
    // Emit a whitespace hint to flush UI rendering once tool calls begin
    if (
      !this._emittedBeginToolCallsHint &&
      this.hasEmittedAssistantText &&
      toolCalls.length > 0
    ) {
      progress.report(new vscode.LanguageModelTextPart(" "));
      this._emittedBeginToolCallsHint = true;
    }

    for (const tc of toolCalls) {
      const idx = tc.index ?? 0;
      // Ignore any further deltas for an index we've already completed
      if (this._completedToolCallIndices.has(idx)) {
        continue;
      }
      const buf = this._toolCallBuffers.get(idx) ?? { args: "" };
      if (tc.id && typeof tc.id === "string") {
        buf.id = tc.id;
      }
      const func = tc.function;
      if (func?.name && typeof func.name === "string") {
        buf.name = func.name;
      }
      if (typeof func?.arguments === "string") {
        buf.args += func.arguments;
      }
      this._toolCallBuffers.set(idx, buf);

      // Emit immediately once arguments become valid JSON
      this.tryEmitBufferedToolCall(idx, progress);
    }
  }

  /**
   * Handle finish_reason from a delta: flush pending tool calls.
   */
  handleFinishReason(
    finishReason: string | null | undefined,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>
  ): void {
    if (finishReason === "tool_calls" || finishReason === "stop") {
      this.flushToolCallBuffers(progress, true);
    }
  }

  /**
   * Parse provider control tokens embedded in streamed text and emit text/tool calls.
   */
  processTextContent(
    input: string,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>
  ): { emittedText: boolean; emittedAny: boolean } {
    const BEGIN = "<|tool_call_begin|>";
    const ARG_BEGIN = "<|tool_call_argument_begin|>";
    const END = "<|tool_call_end|>";

    let data = this._textToolParserBuffer + input;
    let emittedText = false;
    let emittedAny = false;
    let visibleOut = "";

    while (data.length > 0) {
      if (!this._textToolActive) {
        const b = data.indexOf(BEGIN);
        if (b === -1) {
          let longestPartialPrefix = 0;
          for (
            let k = Math.min(BEGIN.length - 1, data.length - 1);
            k > 0;
            k--
          ) {
            if (data.endsWith(BEGIN.slice(0, k))) {
              longestPartialPrefix = k;
              break;
            }
          }

          if (longestPartialPrefix > 0) {
            const visible = data.slice(0, data.length - longestPartialPrefix);
            if (visible) {
              visibleOut += this.stripControlTokens(visible);
            }
            this._textToolParserBuffer = data.slice(
              data.length - longestPartialPrefix
            );
            data = "";
            break;
          }

          const lines = data.split(/\r?\n/);
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const emittedJsonTool = this.tryEmitJsonToolCallLine(
              line,
              progress
            );
            if (emittedJsonTool) {
              emittedAny = true;
              continue;
            }
            visibleOut += this.stripControlTokens(line);
            if (i < lines.length - 1) {
              visibleOut += "\n";
            }
          }
          data = "";
          break;
        }

        const pre = data.slice(0, b);
        if (pre) {
          visibleOut += this.stripControlTokens(pre);
        }
        data = data.slice(b + BEGIN.length);

        const a = data.indexOf(ARG_BEGIN);
        const e = data.indexOf(END);
        let delimIdx = -1;
        let delimKind: "arg" | "end" | undefined;
        if (a !== -1 && (e === -1 || a < e)) {
          delimIdx = a;
          delimKind = "arg";
        } else if (e !== -1) {
          delimIdx = e;
          delimKind = "end";
        } else {
          this._textToolParserBuffer = BEGIN + data;
          data = "";
          break;
        }

        const header = data.slice(0, delimIdx).trim();
        const m = header.match(/^([A-Za-z0-9_\-.]+)(?::(\d+))?/);
        const name = m?.[1];
        const index = m?.[2] ? Number(m[2]) : undefined;
        this._textToolActive = { name, index, argBuffer: "", emitted: false };

        if (delimKind === "arg") {
          data = data.slice(delimIdx + ARG_BEGIN.length);
        } else {
          data = data.slice(delimIdx + END.length);
          const did = this.emitTextToolCallIfValid(
            progress,
            this._textToolActive,
            "{}"
          );
          if (did) {
            this._textToolActive.emitted = true;
            emittedAny = true;
          }
          this._textToolActive = undefined;
        }
        continue;
      }

      const e2 = data.indexOf(END);
      if (e2 === -1) {
        this._textToolActive.argBuffer += data;
        if (!this._textToolActive.emitted) {
          const did = this.emitTextToolCallIfValid(
            progress,
            this._textToolActive,
            this._textToolActive.argBuffer
          );
          if (did) {
            this._textToolActive.emitted = true;
            emittedAny = true;
          }
        }
        data = "";
        break;
      }

      this._textToolActive.argBuffer += data.slice(0, e2);
      data = data.slice(e2 + END.length);
      if (!this._textToolActive.emitted) {
        const did = this.emitTextToolCallIfValid(
          progress,
          this._textToolActive,
          this._textToolActive.argBuffer
        );
        if (did) {
          emittedAny = true;
        }
      }
      this._textToolActive = undefined;
    }

    if (visibleOut.length > 0) {
      progress.report(new vscode.LanguageModelTextPart(visibleOut));
      emittedText = true;
      emittedAny = true;
    }

    this._textToolParserBuffer = data;
    return { emittedText, emittedAny };
  }

  /**
   * Detect and emit tool calls serialized as plain JSON text lines.
   */
  private tryEmitJsonToolCallLine(
    line: string,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>
  ): boolean {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
      return false;
    }

    const parsed = tryParseJSONObject<Record<string, Json>>(trimmed);
    if (!parsed.ok) {
      return false;
    }

    const obj = parsed.value;
    const fn = (obj.function ?? null) as Record<string, Json> | null;
    const name =
      typeof obj.name === "string"
        ? obj.name
        : fn && typeof fn.name === "string"
          ? fn.name
          : undefined;
    if (!name) {
      return false;
    }

    const callId =
      typeof obj.callId === "string"
        ? obj.callId
        : typeof obj.id === "string"
          ? obj.id
          : undefined;

    let input: Record<string, Json> | undefined;
    const inputVal = obj.input;
    if (inputVal && typeof inputVal === "object" && !Array.isArray(inputVal)) {
      input = inputVal as Record<string, Json>;
    }

    if (!input) {
      const argsVal = obj.arguments ?? fn?.arguments;
      if (typeof argsVal === "string") {
        const parsedArgs = tryParseJSONObject<Record<string, Json>>(argsVal);
        if (!parsedArgs.ok) {
          return false;
        }
        input = parsedArgs.value;
      } else if (
        argsVal &&
        typeof argsVal === "object" &&
        !Array.isArray(argsVal)
      ) {
        input = argsVal as Record<string, Json>;
      }
    }

    if (!input) {
      return false;
    }

    try {
      const canonical = JSON.stringify(input);
      const key = `${name}:${canonical}`;
      if (this._emittedTextToolCallKeys.has(key)) {
        return true;
      }
      this._emittedTextToolCallKeys.add(key);
      if (callId) {
        this._emittedTextToolCallIds.add(`${name}:${callId}`);
      }
    } catch {
      // Fall through and emit even if canonicalization fails.
    }

    progress.report(
      new vscode.LanguageModelToolCallPart(
        callId ?? `jtc_${Math.random().toString(36).slice(2, 10)}`,
        name,
        input
      )
    );
    return true;
  }

  /**
   * Validate and emit a text-embedded tool call if the arguments parse as valid JSON.
   */
  private emitTextToolCallIfValid(
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    call: TextToolCallState,
    argText: string
  ): boolean {
    const name = call.name ?? "unknown_tool";
    const parsed = tryParseJSONObject<Record<string, Json>>(argText);
    if (!parsed.ok) {
      return false;
    }

    const canonical = JSON.stringify(parsed.value);
    const key = `${name}:${canonical}`;
    if (typeof call.index === "number") {
      const idKey = `${name}:${call.index}`;
      if (this._emittedTextToolCallIds.has(idKey)) {
        return false;
      }
      this._emittedTextToolCallIds.add(idKey);
    } else if (this._emittedTextToolCallKeys.has(key)) {
      return false;
    }

    this._emittedTextToolCallKeys.add(key);
    const id = `tct_${Math.random().toString(36).slice(2, 10)}`;
    progress.report(
      new vscode.LanguageModelToolCallPart(id, name, parsed.value)
    );
    return true;
  }

  /**
   * Flush any active text-embedded tool call that hasn't been emitted yet.
   */
  flushActiveTextToolCall(
    progress: vscode.Progress<vscode.LanguageModelResponsePart>
  ): void {
    if (!this._textToolActive) {
      return;
    }
    const argText = this._textToolActive.argBuffer;
    const parsed = tryParseJSONObject<Record<string, Json>>(argText);
    if (!parsed.ok) {
      return;
    }
    this.emitTextToolCallIfValid(progress, this._textToolActive, argText);
    this._textToolActive = undefined;
  }

  /** Strip provider control tokens from visible streamed text. */
  private stripControlTokens(text: string): string {
    try {
      return text
        .replace(/<\|[a-zA-Z0-9_-]+_section_(?:begin|end)\|>/g, "")
        .replace(/<\|tool_call_(?:argument_)?(?:begin|end)\|>/g, "");
    } catch {
      return text;
    }
  }

  /**
   * Try to emit a buffered tool call when a valid name and JSON arguments are available.
   */
  private tryEmitBufferedToolCall(
    index: number,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>
  ): void {
    const buf = this._toolCallBuffers.get(index);
    if (!buf) {
      return;
    }
    if (!buf.name) {
      return;
    }
    const canParse = tryParseJSONObject<Record<string, Json>>(buf.args);
    if (!canParse.ok) {
      return;
    }
    const id = buf.id ?? `call_${Math.random().toString(36).slice(2, 10)}`;
    const parameters = canParse.value;
    try {
      const canonical = JSON.stringify(parameters);
      this._emittedTextToolCallKeys.add(`${buf.name}:${canonical}`);
    } catch {
      // Ignore JSON serialization errors; tool call can still be emitted.
    }
    progress.report(
      new vscode.LanguageModelToolCallPart(id, buf.name, parameters)
    );
    this._toolCallBuffers.delete(index);
    this._completedToolCallIndices.add(index);
  }

  /**
   * Flush all buffered tool calls, optionally throwing if arguments are not valid JSON.
   */
  flushToolCallBuffers(
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    throwOnInvalid: boolean
  ): void {
    if (this._toolCallBuffers.size === 0) {
      return;
    }
    for (const [idx, buf] of Array.from(this._toolCallBuffers.entries())) {
      const parsed = tryParseJSONObject<Record<string, Json>>(buf.args);
      if (!parsed.ok) {
        if (throwOnInvalid) {
          console.error("Invalid JSON for tool call", {
            idx,
            snippet: (buf.args || "").slice(0, 200),
          });
          throw new Error("Invalid JSON for tool call");
        }
        // When not throwing (e.g. on [DONE]), drop silently
        continue;
      }
      const id = buf.id ?? `call_${Math.random().toString(36).slice(2, 10)}`;
      const name = buf.name ?? "unknown_tool";
      const parameters = parsed.value;
      try {
        const canonical = JSON.stringify(parameters);
        this._emittedTextToolCallKeys.add(`${name}:${canonical}`);
      } catch {
        // Ignore JSON serialization errors; tool call can still be emitted.
      }
      progress.report(
        new vscode.LanguageModelToolCallPart(id, name, parameters)
      );
      this._toolCallBuffers.delete(idx);
      this._completedToolCallIndices.add(idx);
    }
  }
}
