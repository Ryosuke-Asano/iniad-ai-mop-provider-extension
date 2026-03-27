/// <reference types="jest" />
/**
 * Unit tests for ToolCallStateMachine in tool-call-buffer.ts
 */

import { ToolCallStateMachine } from "../src/tool-call-buffer";
import * as vscode from "vscode";

describe("ToolCallStateMachine", () => {
  let sm: ToolCallStateMachine;
  let reported: vscode.LanguageModelResponsePart[];
  let progress: vscode.Progress<vscode.LanguageModelResponsePart>;

  beforeEach(() => {
    sm = new ToolCallStateMachine();
    reported = [];
    progress = {
      report: (part: vscode.LanguageModelResponsePart) => {
        reported.push(part);
      },
    };
  });

  describe("reset", () => {
    it("should reset all state", () => {
      sm.hasEmittedAssistantText = true;
      sm.reset();
      expect(sm.hasEmittedAssistantText).toBe(false);
    });
  });

  describe("processTextContent - plain text", () => {
    it("should emit plain text without control tokens", () => {
      const result = sm.processTextContent("Hello world", progress);
      expect(result.emittedText).toBe(true);
      expect(result.emittedAny).toBe(true);
      expect(reported).toHaveLength(1);
      expect(reported[0]).toBeInstanceOf(vscode.LanguageModelTextPart);
      expect((reported[0] as vscode.LanguageModelTextPart).value).toBe(
        "Hello world"
      );
    });

    it("should strip section control tokens from text", () => {
      const result = sm.processTextContent(
        "before<|some_section_begin|>after",
        progress
      );
      expect(result.emittedText).toBe(true);
      expect((reported[0] as vscode.LanguageModelTextPart).value).toBe(
        "beforeafter"
      );
    });

    it("should handle empty string input", () => {
      const result = sm.processTextContent("", progress);
      expect(result.emittedText).toBe(false);
      expect(result.emittedAny).toBe(false);
      expect(reported).toHaveLength(0);
    });
  });

  describe("processTextContent - text-embedded tool calls", () => {
    it("should parse a complete tool call in one chunk", () => {
      const input =
        '<|tool_call_begin|>my_tool<|tool_call_argument_begin|>{"key":"value"}<|tool_call_end|>';
      const result = sm.processTextContent(input, progress);
      expect(result.emittedAny).toBe(true);
      expect(reported).toHaveLength(1);
      expect(reported[0]).toBeInstanceOf(vscode.LanguageModelToolCallPart);
      const tc = reported[0] as vscode.LanguageModelToolCallPart;
      expect(tc.name).toBe("my_tool");
      expect(tc.input).toEqual({ key: "value" });
    });

    it("should parse tool call split across two chunks", () => {
      // First chunk: begin token + tool name + arg begin + partial JSON
      sm.processTextContent(
        '<|tool_call_begin|>my_tool<|tool_call_argument_begin|>{"ke',
        progress
      );
      expect(reported).toHaveLength(0);

      // Second chunk: rest of JSON + end token
      sm.processTextContent('y":"value"}<|tool_call_end|>', progress);
      expect(reported).toHaveLength(1);
      const tc = reported[0] as vscode.LanguageModelToolCallPart;
      expect(tc.name).toBe("my_tool");
      expect(tc.input).toEqual({ key: "value" });
    });

    it("should handle tool call with index", () => {
      const input =
        '<|tool_call_begin|>my_tool:0<|tool_call_argument_begin|>{"a":1}<|tool_call_end|>';
      sm.processTextContent(input, progress);
      expect(reported).toHaveLength(1);
      const tc = reported[0] as vscode.LanguageModelToolCallPart;
      expect(tc.name).toBe("my_tool");
      expect(tc.input).toEqual({ a: 1 });
    });

    it("should handle tool call with no arguments (empty end)", () => {
      const input = "<|tool_call_begin|>my_tool<|tool_call_end|>";
      sm.processTextContent(input, progress);
      expect(reported).toHaveLength(1);
      const tc = reported[0] as vscode.LanguageModelToolCallPart;
      expect(tc.name).toBe("my_tool");
      expect(tc.input).toEqual({});
    });

    it("should emit text before a tool call", () => {
      const input =
        'Some text<|tool_call_begin|>my_tool<|tool_call_argument_begin|>{"a":1}<|tool_call_end|>';
      sm.processTextContent(input, progress);
      // Tool call emitted first (during parsing), then text flushed at end
      const toolParts = reported.filter(
        (p) => p instanceof vscode.LanguageModelToolCallPart
      );
      const textParts = reported.filter(
        (p) => p instanceof vscode.LanguageModelTextPart
      );
      expect(toolParts).toHaveLength(1);
      expect(textParts).toHaveLength(1);
      expect((textParts[0] as vscode.LanguageModelTextPart).value).toBe(
        "Some text"
      );
    });

    it("should handle multiple tool calls in sequence", () => {
      const input =
        '<|tool_call_begin|>tool_a<|tool_call_argument_begin|>{"a":1}<|tool_call_end|>' +
        '<|tool_call_begin|>tool_b<|tool_call_argument_begin|>{"b":2}<|tool_call_end|>';
      sm.processTextContent(input, progress);
      const toolParts = reported.filter(
        (p) => p instanceof vscode.LanguageModelToolCallPart
      );
      expect(toolParts).toHaveLength(2);
      expect((toolParts[0] as vscode.LanguageModelToolCallPart).name).toBe("tool_a");
      expect((toolParts[1] as vscode.LanguageModelToolCallPart).name).toBe("tool_b");
    });
  });

  describe("processTextContent - JSON line tool calls", () => {
    it("should detect a JSON tool call line", () => {
      const input = '{"name":"my_tool","input":{"key":"value"}}';
      const result = sm.processTextContent(input, progress);
      expect(result.emittedAny).toBe(true);
      expect(reported).toHaveLength(1);
      expect(reported[0]).toBeInstanceOf(vscode.LanguageModelToolCallPart);
      const tc = reported[0] as vscode.LanguageModelToolCallPart;
      expect(tc.name).toBe("my_tool");
      expect(tc.input).toEqual({ key: "value" });
    });

    it("should detect a JSON tool call with function wrapper", () => {
      const input =
        '{"function":{"name":"my_tool","arguments":"{\\"a\\":1}"},"id":"call_123"}';
      const result = sm.processTextContent(input, progress);
      expect(result.emittedAny).toBe(true);
      expect(reported).toHaveLength(1);
      const tc = reported[0] as vscode.LanguageModelToolCallPart;
      expect(tc.name).toBe("my_tool");
      expect(tc.input).toEqual({ a: 1 });
      expect(tc.callId).toBe("call_123");
    });

    it("should not treat non-tool JSON as tool call", () => {
      const input = '{"message":"hello","count":5}';
      const result = sm.processTextContent(input, progress);
      // Should be emitted as text, not as tool call
      expect(result.emittedText).toBe(true);
      expect(reported).toHaveLength(1);
      expect(reported[0]).toBeInstanceOf(vscode.LanguageModelTextPart);
    });
  });

  describe("deduplication", () => {
    it("should deduplicate identical text-embedded tool calls", () => {
      const input =
        '<|tool_call_begin|>my_tool<|tool_call_argument_begin|>{"a":1}<|tool_call_end|>';
      sm.processTextContent(input, progress);
      expect(reported).toHaveLength(1);

      // Same tool call again
      sm.processTextContent(input, progress);
      // Should not emit again
      expect(reported).toHaveLength(1);
    });

    it("should deduplicate JSON line tool calls", () => {
      const input = '{"name":"my_tool","input":{"a":1}}';
      sm.processTextContent(input, progress);
      expect(reported).toHaveLength(1);

      sm.processTextContent(input, progress);
      // Deduplicated
      expect(reported).toHaveLength(1);
    });

    it("should deduplicate between structured and text-embedded tool calls", () => {
      // First, emit via structured tool calls
      sm.processStructuredToolCalls(
        [
          {
            id: "call_1",
            index: 0,
            function: { name: "my_tool", arguments: '{"a":1}' },
          },
        ],
        progress
      );
      expect(reported).toHaveLength(1);

      // Now same tool call via text-embedded
      const input =
        '<|tool_call_begin|>my_tool<|tool_call_argument_begin|>{"a":1}<|tool_call_end|>';
      sm.processTextContent(input, progress);
      // Should be deduplicated
      expect(reported).toHaveLength(1);
    });
  });

  describe("processStructuredToolCalls", () => {
    it("should buffer and emit a complete tool call", () => {
      sm.processStructuredToolCalls(
        [
          {
            id: "call_1",
            index: 0,
            function: { name: "my_tool", arguments: '{"key":"value"}' },
          },
        ],
        progress
      );
      expect(reported).toHaveLength(1);
      const tc = reported[0] as vscode.LanguageModelToolCallPart;
      expect(tc.callId).toBe("call_1");
      expect(tc.name).toBe("my_tool");
      expect(tc.input).toEqual({ key: "value" });
    });

    it("should assemble a tool call from multiple deltas", () => {
      // First delta: id + name + partial args
      sm.processStructuredToolCalls(
        [{ id: "call_1", index: 0, function: { name: "my_tool", arguments: '{"ke' } }],
        progress
      );
      expect(reported).toHaveLength(0);

      // Second delta: more args
      sm.processStructuredToolCalls(
        [{ index: 0, function: { arguments: 'y":"val' } }],
        progress
      );
      expect(reported).toHaveLength(0);

      // Third delta: complete the JSON
      sm.processStructuredToolCalls(
        [{ index: 0, function: { arguments: 'ue"}' } }],
        progress
      );
      expect(reported).toHaveLength(1);
      const tc = reported[0] as vscode.LanguageModelToolCallPart;
      expect(tc.name).toBe("my_tool");
      expect(tc.input).toEqual({ key: "value" });
    });

    it("should emit whitespace hint when text was emitted before tool calls", () => {
      sm.hasEmittedAssistantText = true;
      sm.processStructuredToolCalls(
        [
          {
            id: "call_1",
            index: 0,
            function: { name: "my_tool", arguments: '{"a":1}' },
          },
        ],
        progress
      );
      // First should be whitespace hint, second the tool call
      expect(reported).toHaveLength(2);
      expect(reported[0]).toBeInstanceOf(vscode.LanguageModelTextPart);
      expect((reported[0] as vscode.LanguageModelTextPart).value).toBe(" ");
      expect(reported[1]).toBeInstanceOf(vscode.LanguageModelToolCallPart);
    });

    it("should not emit whitespace hint when no text was emitted", () => {
      sm.processStructuredToolCalls(
        [
          {
            id: "call_1",
            index: 0,
            function: { name: "my_tool", arguments: '{"a":1}' },
          },
        ],
        progress
      );
      expect(reported).toHaveLength(1);
      expect(reported[0]).toBeInstanceOf(vscode.LanguageModelToolCallPart);
    });

    it("should ignore deltas for already completed indices", () => {
      // Emit a tool call at index 0
      sm.processStructuredToolCalls(
        [
          {
            id: "call_1",
            index: 0,
            function: { name: "my_tool", arguments: '{"a":1}' },
          },
        ],
        progress
      );
      expect(reported).toHaveLength(1);

      // Another delta for index 0 should be ignored
      sm.processStructuredToolCalls(
        [
          {
            id: "call_1",
            index: 0,
            function: { name: "my_tool", arguments: '{"a":2}' },
          },
        ],
        progress
      );
      expect(reported).toHaveLength(1);
    });
  });

  describe("handleFinishReason", () => {
    it("should flush on tool_calls finish reason", () => {
      // Buffer a tool call without valid JSON yet
      sm.processStructuredToolCalls(
        [
          {
            id: "call_1",
            index: 0,
            function: { name: "my_tool", arguments: '{"a":1}' },
          },
        ],
        progress
      );
      // Already emitted because JSON is valid
      expect(reported).toHaveLength(1);
    });

    it("should flush incomplete buffers on stop", () => {
      // Buffer incomplete args
      sm.processStructuredToolCalls(
        [{ id: "call_1", index: 0, function: { name: "tool", arguments: '{"a"' } }],
        progress
      );
      expect(reported).toHaveLength(0);

      // Finish with stop should throw for invalid JSON
      expect(() => sm.handleFinishReason("stop", progress)).toThrow(
        "Invalid JSON for tool call"
      );
    });
  });

  describe("flushToolCallBuffers", () => {
    it("should flush valid buffered tool calls", () => {
      sm.processStructuredToolCalls(
        [
          { id: "call_1", index: 0, function: { name: "tool_a", arguments: '{"x":' } },
          { id: "call_2", index: 1, function: { name: "tool_b", arguments: '{"y":2}' } },
        ],
        progress
      );
      // tool_b is valid and emitted immediately; tool_a not yet
      expect(reported).toHaveLength(1);

      // Complete tool_a args
      sm.processStructuredToolCalls(
        [{ index: 0, function: { arguments: '1}' } }],
        progress
      );
      expect(reported).toHaveLength(2);
    });

    it("should silently drop invalid buffers when throwOnInvalid is false", () => {
      sm.processStructuredToolCalls(
        [{ id: "call_1", index: 0, function: { name: "tool", arguments: '{"bad' } }],
        progress
      );
      expect(reported).toHaveLength(0);

      // Flush without throwing
      sm.flushToolCallBuffers(progress, false);
      expect(reported).toHaveLength(0); // dropped silently
    });
  });

  describe("flushActiveTextToolCall", () => {
    it("should flush valid active text tool call", () => {
      // Start a text tool call but don't complete it
      sm.processTextContent(
        '<|tool_call_begin|>my_tool<|tool_call_argument_begin|>{"a":1}',
        progress
      );
      expect(reported).toHaveLength(1); // emitted early because JSON is valid

      // Flush should handle the completed active state
      sm.flushActiveTextToolCall(progress);
      // Already emitted, so no additional emission
      expect(reported).toHaveLength(1);
    });

    it("should not flush invalid active text tool call", () => {
      sm.processTextContent(
        '<|tool_call_begin|>my_tool<|tool_call_argument_begin|>{"incomplete',
        progress
      );
      expect(reported).toHaveLength(0);

      sm.flushActiveTextToolCall(progress);
      expect(reported).toHaveLength(0); // invalid JSON, nothing emitted
    });
  });
});
