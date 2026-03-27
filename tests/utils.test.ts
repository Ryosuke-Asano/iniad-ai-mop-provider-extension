/// <reference types="jest" />
/**
 * Unit tests for utility functions in utils.ts
 */

import * as vscode from "../__mocks__/vscode";
import * as realVscode from "vscode";
import type { LegacyPart } from "../src/utils";
import {
  tryParseJSONObject,
  validateRequest,
  estimateTokens,
  estimateMessagesTokens,
  convertMessages,
  convertTools,
} from "../src/utils";

function toValidatableMessages(
  messages: vscode.LanguageModelChatMessage[]
): readonly {
  role: string;
  content: (realVscode.LanguageModelInputPart | LegacyPart)[];
}[] {
  return messages as unknown as readonly {
    role: string;
    content: (realVscode.LanguageModelInputPart | LegacyPart)[];
  }[];
}

function toEstimatableMessages(
  messages: vscode.LanguageModelChatMessage[]
): readonly { content: (realVscode.LanguageModelInputPart | LegacyPart)[] }[] {
  return messages as unknown as readonly {
    content: (realVscode.LanguageModelInputPart | LegacyPart)[];
  }[];
}

describe("tryParseJSONObject", () => {
  it("should parse valid JSON object successfully", () => {
    const result = tryParseJSONObject('{"name": "test", "value": 123}');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ name: "test", value: 123 });
    }
  });

  it("should parse valid JSON array successfully", () => {
    const result = tryParseJSONObject("[1, 2, 3]");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual([1, 2, 3]);
    }
  });

  it("should return error for invalid JSON", () => {
    const result = tryParseJSONObject("{invalid json}");
    expect(result.ok).toBe(false);
  });

  it("should return error for empty string", () => {
    const result = tryParseJSONObject("");
    expect(result.ok).toBe(false);
  });
});

describe("validateRequest", () => {
  it("should pass validation for valid message array", () => {
    const message = new vscode.LanguageModelChatMessage(
      vscode.LanguageModelChatMessageRole.User,
      [new vscode.LanguageModelTextPart("Hello")]
    );
    expect(() =>
      validateRequest(toValidatableMessages([message]))
    ).not.toThrow();
  });

  it("should throw error for empty message array", () => {
    expect(() => validateRequest([])).toThrow("Messages array is empty");
  });

  it("should throw error for null messages", () => {
    // @ts-expect-error: testing invalid input
    expect(() => validateRequest(null)).toThrow("Messages array is empty");
  });

  it("should throw error for message with no content", () => {
    const message = new vscode.LanguageModelChatMessage(
      vscode.LanguageModelChatMessageRole.User,
      []
    );
    expect(() => validateRequest(toValidatableMessages([message]))).toThrow(
      "Message has no content"
    );
  });
});

describe("estimateTokens", () => {
  it("should estimate tokens for empty string", () => {
    expect(estimateTokens("")).toBe(0);
  });

  it("should estimate tokens for short text", () => {
    const text = "Hello";
    expect(estimateTokens(text)).toBe(Math.ceil(5 / 4));
  });

  it("should handle unicode characters", () => {
    const text = "こんにちは世界";
    expect(estimateTokens(text)).toBe(Math.ceil(7 / 4));
  });
});

describe("estimateMessagesTokens", () => {
  it("should estimate tokens for single text message", () => {
    const message = new vscode.LanguageModelChatMessage(
      vscode.LanguageModelChatMessageRole.User,
      [new vscode.LanguageModelTextPart("Hello world")]
    );
    const tokens = estimateMessagesTokens(toEstimatableMessages([message]));
    expect(tokens).toBe(Math.ceil(11 / 4));
  });

  it("should estimate tokens for messages with images", () => {
    const mockImagePart = new vscode.LanguageModelDataPart(
      new Uint8Array([1, 2, 3, 4]),
      "image/png"
    );

    const message = new vscode.LanguageModelChatMessage(
      vscode.LanguageModelChatMessageRole.User,
      [new vscode.LanguageModelTextPart("Describe this"), mockImagePart]
    );
    const tokens = estimateMessagesTokens(toEstimatableMessages([message]));
    expect(tokens).toBeGreaterThanOrEqual(1500);
  });

  it("should handle empty messages array", () => {
    const tokens = estimateMessagesTokens([]);
    expect(tokens).toBe(0);
  });
});

describe("convertTools", () => {
  const weatherTool: realVscode.LanguageModelChatTool = {
    name: "get_weather",
    description: "Get weather",
    inputSchema: {
      type: "object",
      properties: {
        location: { type: "string" },
      },
      required: ["location"],
    },
  };

  it("should return empty config when no tools are provided", () => {
    const options = {} as realVscode.ProvideLanguageModelChatResponseOptions;
    expect(convertTools(options)).toEqual({});
  });

  it("should return auto tool_choice in auto mode", () => {
    const options = {
      tools: [weatherTool],
      toolMode: vscode.LanguageModelChatToolMode.Auto,
    } as realVscode.ProvideLanguageModelChatResponseOptions;

    const result = convertTools(options);
    expect(result.tools).toBeDefined();
    expect(result.tools?.length).toBe(1);
    expect(result.tool_choice).toBe("auto");
  });

  it("should force a specific function in required mode with one tool", () => {
    const options = {
      tools: [weatherTool],
      toolMode: vscode.LanguageModelChatToolMode.Required,
    } as realVscode.ProvideLanguageModelChatResponseOptions;

    const result = convertTools(options);
    expect(result.tool_choice).toEqual({
      type: "function",
      function: { name: "get_weather" },
    });
  });

  it("should throw in required mode with no tools", () => {
    const options = {
      toolMode: vscode.LanguageModelChatToolMode.Required,
    } as realVscode.ProvideLanguageModelChatResponseOptions;

    expect(() => convertTools(options)).toThrow(
      "LanguageModelChatToolMode.Required requires at least one tool."
    );
  });

  it("should throw in required mode with multiple tools", () => {
    const options = {
      tools: [weatherTool, { ...weatherTool, name: "get_time" }],
      toolMode: vscode.LanguageModelChatToolMode.Required,
    } as realVscode.ProvideLanguageModelChatResponseOptions;

    expect(() => convertTools(options)).toThrow(
      "LanguageModelChatToolMode.Required is not supported with more than one tool."
    );
  });
});

describe("convertMessages", () => {
  it("should serialize assistant tool calls as assistant message with tool_calls", () => {
    const assistant = new vscode.LanguageModelChatMessage(
      vscode.LanguageModelChatMessageRole.Assistant,
      [
        new vscode.LanguageModelTextPart("Calling tool"),
        new vscode.LanguageModelToolCallPart("call_1", "get_weather", {
          location: "Tokyo",
        }),
      ]
    );

    const result = convertMessages([assistant]);
    expect(result.length).toBe(1);
    expect(result[0].role).toBe("assistant");
    expect(result[0].tool_calls?.length).toBe(1);
    expect(result[0].tool_calls?.[0].function.name).toBe("get_weather");
  });

  it("should serialize tool results as role=tool messages", () => {
    const userToolResult = new vscode.LanguageModelChatMessage(
      vscode.LanguageModelChatMessageRole.User,
      [
        new vscode.LanguageModelToolResultPart("call_1", [
          new vscode.LanguageModelTextPart("Sunny"),
        ]),
      ]
    );

    const result = convertMessages([userToolResult]);
    expect(result.length).toBe(1);
    expect(result[0].role).toBe("tool");
    expect(result[0].tool_call_id).toBe("call_1");
    expect(result[0].content).toBe("Sunny");
  });

  it("should not emit empty user messages for tool-result-only turns", () => {
    const userToolResult = new vscode.LanguageModelChatMessage(
      vscode.LanguageModelChatMessageRole.User,
      [
        new vscode.LanguageModelToolResultPart("call_1", [
          new vscode.LanguageModelTextPart("42"),
        ]),
      ]
    );

    const result = convertMessages([userToolResult]);
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe("tool");
  });
});
