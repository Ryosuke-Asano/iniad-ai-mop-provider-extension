/**
 * Anthropic Messages API types, message/tool conversion, and stream delta processing.
 * Used for Claude models available via INIAD's Anthropic-compatible endpoint.
 */
import * as vscode from "vscode";
import type { Json, JsonObject } from "./types";
import {
  getTextPartValue,
  extractImageData,
  getToolCallInfo,
  getToolResultTexts,
  LegacyPart,
} from "./utils";
import type { ToolCallStateMachine } from "./tool-call-buffer";
import { MAX_TOOL_RESULT_CHARS } from "./constants";

// ---------------------------------------------------------------------------
// Anthropic request types
// ---------------------------------------------------------------------------

export interface AnthropicContentBlock {
  type: "text" | "image" | "tool_use" | "tool_result";
  // text
  text?: string;
  // image
  source?: { type: "base64"; media_type: string; data: string };
  // tool_use
  id?: string;
  name?: string;
  input?: Json;
  // tool_result
  tool_use_id?: string;
  content?: string | AnthropicContentBlock[];
  is_error?: boolean;
}

export interface AnthropicMessage {
  role: "user" | "assistant";
  content: string | AnthropicContentBlock[];
}

export interface AnthropicTool {
  name: string;
  description?: string;
  input_schema: JsonObject;
}

export interface AnthropicRequestBody {
  model: string;
  max_tokens: number;
  stream: boolean;
  system?: string;
  messages: AnthropicMessage[];
  temperature?: number;
  stop_sequences?: string[];
  tools?: AnthropicTool[];
  tool_choice?: { type: "auto" | "any" | "tool"; name?: string };
}

// ---------------------------------------------------------------------------
// Anthropic streaming event types
// ---------------------------------------------------------------------------

export interface AnthropicStreamEvent {
  type: string;
  // message_start
  message?: {
    id: string;
    type: string;
    role: string;
    model: string;
    stop_reason: string | null;
    usage?: { input_tokens: number; output_tokens: number };
  };
  // content_block_start / content_block_stop
  index?: number;
  content_block?: {
    type: "text" | "tool_use";
    text?: string;
    id?: string;
    name?: string;
    input?: Json;
  };
  // content_block_delta
  delta?: {
    type: string; // "text_delta" | "input_json_delta"
    text?: string;
    partial_json?: string;
    // message_delta fields
    stop_reason?: string;
    stop_sequence?: string | null;
  };
  // message_delta usage
  usage?: { output_tokens: number };
}

// ---------------------------------------------------------------------------
// Message conversion: VS Code → Anthropic format
// ---------------------------------------------------------------------------

export function convertMessagesAnthropic(
  messages: readonly vscode.LanguageModelChatMessage[],
  options?: { maxToolResultChars?: number }
): { system: string | undefined; messages: AnthropicMessage[] } {
  const systemParts: string[] = [];
  const rawMessages: AnthropicMessage[] = [];

  for (const msg of messages) {
    // Extract system messages (any role that isn't User or Assistant)
    if (
      msg.role !== vscode.LanguageModelChatMessageRole.User &&
      msg.role !== vscode.LanguageModelChatMessageRole.Assistant
    ) {
      for (const part of msg.content) {
        const tv = getTextPartValue(part);
        if (tv !== undefined) {
          systemParts.push(tv);
        }
      }
      continue;
    }

    const role: "user" | "assistant" =
      msg.role === vscode.LanguageModelChatMessageRole.Assistant
        ? "assistant"
        : "user";

    const contentBlocks: AnthropicContentBlock[] = [];

    // Collect text parts
    for (const part of msg.content) {
      const tv = getTextPartValue(part);
      if (tv !== undefined) {
        contentBlocks.push({ type: "text", text: tv });
        continue;
      }

      // Image parts
      const img = extractImageData(part);
      if (img) {
        const base64Data = Buffer.from(img.data).toString("base64");
        contentBlocks.push({
          type: "image",
          source: {
            type: "base64",
            media_type: img.mimeType,
            data: base64Data,
          },
        });
        continue;
      }

      // Tool call parts → tool_use content blocks (assistant role)
      const toolCall = getToolCallInfo(part);
      if (toolCall) {
        let parsedInput: Json = {};
        if (typeof toolCall.args === "string") {
          try {
            parsedInput = JSON.parse(toolCall.args) as Json;
          } catch {
            parsedInput = {};
          }
        } else if (toolCall.args !== undefined) {
          parsedInput = toolCall.args;
        }
        contentBlocks.push({
          type: "tool_use",
          id:
            toolCall.id ??
            `call_${Math.random().toString(36).slice(2, 10)}`,
          name: toolCall.name ?? "unknown",
          input: parsedInput,
        });
        continue;
      }

      // Tool result parts → tool_result content blocks (user role)
      if (part instanceof vscode.LanguageModelToolResultPart) {
        const texts = getToolResultTexts(
          part,
          options?.maxToolResultChars ?? MAX_TOOL_RESULT_CHARS
        );
        contentBlocks.push({
          type: "tool_result",
          tool_use_id: part.callId,
          content: texts.join("\n") || "",
        });
        continue;
      }

      // Legacy tool result parts
      const legacy = part as LegacyPart;
      if (
        typeof legacy.callId === "string" &&
        legacy.callId &&
        (legacy.type === "tool_result" || legacy.type === "tool_result_part")
      ) {
        const texts = getToolResultTexts(
          legacy,
          options?.maxToolResultChars ?? MAX_TOOL_RESULT_CHARS
        );
        contentBlocks.push({
          type: "tool_result",
          tool_use_id: legacy.callId,
          content: texts.join("\n") || "",
        });
      }
    }

    if (contentBlocks.length === 0) {
      contentBlocks.push({ type: "text", text: "(empty message)" });
    }

    // Tool results must be in user messages
    const hasToolResult = contentBlocks.some((b) => b.type === "tool_result");
    const effectiveRole = hasToolResult ? "user" : role;

    rawMessages.push({ role: effectiveRole, content: contentBlocks });
  }

  // Enforce strict user/assistant alternation by merging consecutive same-role messages
  const merged: AnthropicMessage[] = [];
  for (const msg of rawMessages) {
    const prev = merged[merged.length - 1];
    if (prev && prev.role === msg.role) {
      // Merge content arrays
      const prevBlocks = Array.isArray(prev.content)
        ? prev.content
        : [{ type: "text" as const, text: prev.content }];
      const curBlocks = Array.isArray(msg.content)
        ? msg.content
        : [{ type: "text" as const, text: msg.content }];
      prev.content = [...prevBlocks, ...curBlocks];
    } else {
      merged.push({ ...msg });
    }
  }

  // Anthropic requires messages to start with user role
  if (merged.length > 0 && merged[0].role !== "user") {
    merged.unshift({ role: "user", content: [{ type: "text", text: "." }] });
  }

  return {
    system: systemParts.length > 0 ? systemParts.join("\n\n") : undefined,
    messages: merged,
  };
}

// ---------------------------------------------------------------------------
// Tool conversion: VS Code → Anthropic format
// ---------------------------------------------------------------------------

export function convertToolsAnthropic(
  options: vscode.ProvideLanguageModelChatResponseOptions
): {
  tools?: AnthropicTool[];
  tool_choice?: { type: "auto" | "any" | "tool"; name?: string };
} {
  const toolsInput = options.tools ?? [];
  if (toolsInput.length === 0) {
    if (options.toolMode === vscode.LanguageModelChatToolMode.Required) {
      throw new Error(
        "LanguageModelChatToolMode.Required requires at least one tool."
      );
    }
    return {};
  }

  const tools: AnthropicTool[] = toolsInput.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema as JsonObject,
  }));

  let tool_choice: { type: "auto" | "any" | "tool"; name?: string } = {
    type: "auto",
  };

  if (options.toolMode === vscode.LanguageModelChatToolMode.Required) {
    if (tools.length === 1) {
      tool_choice = { type: "tool", name: tools[0].name };
    } else {
      tool_choice = { type: "any" };
    }
  }

  return { tools, tool_choice };
}

// ---------------------------------------------------------------------------
// Stream delta processing: Anthropic events → VS Code progress parts
// ---------------------------------------------------------------------------

/**
 * Map an Anthropic SSE event to ToolCallStateMachine calls and progress reports.
 */
export function processAnthropicDelta(
  event: AnthropicStreamEvent,
  progress: vscode.Progress<vscode.LanguageModelResponsePart>,
  toolCallState: ToolCallStateMachine
): void {
  switch (event.type) {
    case "content_block_start": {
      const block = event.content_block;
      if (block?.type === "tool_use" && block.id && block.name) {
        // Initialize tool call buffer with id and name
        toolCallState.processStructuredToolCalls(
          [
            {
              id: block.id,
              index: event.index ?? 0,
              function: { name: block.name, arguments: "" },
            },
          ],
          progress
        );
      }
      break;
    }

    case "content_block_delta": {
      const delta = event.delta;
      if (!delta) break;

      if (delta.type === "text_delta" && delta.text) {
        const textResult = toolCallState.processTextContent(
          delta.text,
          progress
        );
        if (textResult.emittedText) {
          toolCallState.hasEmittedAssistantText = true;
        }
      } else if (delta.type === "input_json_delta" && delta.partial_json) {
        // Stream tool arguments incrementally
        toolCallState.processStructuredToolCalls(
          [
            {
              index: event.index ?? 0,
              function: { arguments: delta.partial_json },
            },
          ],
          progress
        );
      }
      break;
    }

    case "message_delta": {
      const stopReason = event.delta?.stop_reason;
      if (stopReason === "tool_use") {
        toolCallState.handleFinishReason("tool_calls", progress);
      } else if (stopReason === "end_turn" || stopReason === "stop_sequence") {
        toolCallState.handleFinishReason("stop", progress);
      }
      break;
    }

    case "message_stop": {
      toolCallState.flushToolCallBuffers(progress, false);
      toolCallState.flushActiveTextToolCall(progress);
      break;
    }
  }
}
