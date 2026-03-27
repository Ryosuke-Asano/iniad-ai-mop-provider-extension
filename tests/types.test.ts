/// <reference types="jest" />
/**
 * Unit tests for type definitions in types.ts
 */

import {
  IniadContentPart,
  IniadChatMessage,
  IniadToolCall,
  IniadTool,
  IniadChatRequest,
  IniadChatChoice,
  IniadChatResponse,
  IniadStreamChoice,
  IniadStreamResponse,
  INIAD_MODELS,
} from "../src/types";

describe("IniadContentPart", () => {
  it("should create valid text part", () => {
    const part: IniadContentPart = {
      type: "text",
      text: "Hello world",
    };
    expect(part.type).toBe("text");
    expect(part.text).toBe("Hello world");
  });

  it("should create valid image_url part with detail", () => {
    const part: IniadContentPart = {
      type: "image_url",
      image_url: {
        url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+P+/HgAFhAJ/wlseKgAAAABJRU5ErkJggg==",
        detail: "low",
      },
    };
    expect(part.type).toBe("image_url");
    expect(part.image_url).toBeDefined();
    expect(part.image_url?.url).toContain("data:image/png;base64,");
    expect(part.image_url?.detail).toBe("low");
  });

  it("should validate type is either text or image_url", () => {
    const textPart: IniadContentPart = {
      type: "text",
      text: "test",
    };
    expect(["text", "image_url"]).toContain(textPart.type);
  });
});

describe("IniadChatMessage", () => {
  it("should create user message with text content", () => {
    const message: IniadChatMessage = {
      role: "user",
      content: "Hello",
    };
    expect(message.role).toBe("user");
    expect(message.content).toBe("Hello");
  });

  it("should create assistant message with content array", () => {
    const content: IniadContentPart[] = [{ type: "text", text: "Response" }];
    const message: IniadChatMessage = {
      role: "assistant",
      content,
    };
    expect(message.role).toBe("assistant");
    expect(Array.isArray(message.content)).toBe(true);
  });

  it("should include tool_calls in message", () => {
    const toolCall: IniadToolCall = {
      id: "call_123",
      type: "function",
      function: {
        name: "get_weather",
        arguments: '{"location": "Tokyo"}',
      },
    };
    const message: IniadChatMessage = {
      role: "assistant",
      content: "",
      tool_calls: [toolCall],
    };
    expect(message.tool_calls).toBeDefined();
    expect(message.tool_calls?.length).toBe(1);
    expect(message.tool_calls?.[0].function.name).toBe("get_weather");
  });

  it("should include tool_call_id for tool messages", () => {
    const message: IniadChatMessage = {
      role: "tool",
      content: '{"result": "sunny"}',
      tool_call_id: "call_123",
      name: "get_weather",
    };
    expect(message.role).toBe("tool");
    expect(message.tool_call_id).toBe("call_123");
  });
});

describe("IniadToolCall", () => {
  it("should create valid function tool call", () => {
    const toolCall: IniadToolCall = {
      id: "call_123",
      type: "function",
      function: {
        name: "search",
        arguments: '{"query": "test"}',
      },
    };
    expect(toolCall.id).toBe("call_123");
    expect(toolCall.type).toBe("function");
    expect(toolCall.function.name).toBe("search");
  });
});

describe("IniadTool", () => {
  it("should create valid function tool definition", () => {
    const tool: IniadTool = {
      type: "function",
      function: {
        name: "get_current_time",
        description: "Get the current time",
        parameters: {
          type: "object",
          properties: {},
        },
      },
    };
    expect(tool.type).toBe("function");
    expect(tool.function.name).toBe("get_current_time");
    expect(tool.function.description).toBeDefined();
  });
});

describe("IniadChatRequest", () => {
  it("should create basic chat request", () => {
    const request: IniadChatRequest = {
      model: "gpt-5.4",
      messages: [{ role: "user", content: "Hello" }],
    };
    expect(request.model).toBe("gpt-5.4");
    expect(request.messages.length).toBe(1);
  });

  it("should create request with streaming enabled", () => {
    const request: IniadChatRequest = {
      model: "gpt-5.4",
      messages: [],
      stream: true,
    };
    expect(request.stream).toBe(true);
  });

  it("should create request with tools", () => {
    const tool: IniadTool = {
      type: "function",
      function: {
        name: "test_tool",
        description: "A test tool",
      },
    };
    const request: IniadChatRequest = {
      model: "gpt-5.4",
      messages: [],
      tools: [tool],
    };
    expect(request.tools).toBeDefined();
    expect(request.tools?.length).toBe(1);
  });
});

describe("IniadChatResponse", () => {
  it("should create valid chat response", () => {
    const choice: IniadChatChoice = {
      index: 0,
      message: {
        role: "assistant",
        content: "Hello!",
      },
      finish_reason: "stop",
    };
    const response: IniadChatResponse = {
      id: "resp_123",
      object: "chat.completion",
      created: Date.now(),
      model: "gpt-5.4",
      choices: [choice],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 5,
        total_tokens: 15,
      },
    };
    expect(response.id).toBe("resp_123");
    expect(response.choices[0].message.content).toBe("Hello!");
    expect(response.usage.total_tokens).toBe(15);
  });
});

describe("INIAD_MODELS", () => {
  it("should have 3 models", () => {
    expect(INIAD_MODELS.length).toBe(3);
  });

  it("should include gpt-5.4", () => {
    const model = INIAD_MODELS.find((m) => m.id === "gpt-5.4");
    expect(model).toBeDefined();
    expect(model?.supportsVision).toBe(true);
    expect(model?.supportsTools).toBe(true);
    expect(model?.contextWindow).toBe(1000000);
    expect(model?.maxOutput).toBe(131072);
  });

  it("should include gpt-5.4-mini", () => {
    const model = INIAD_MODELS.find((m) => m.id === "gpt-5.4-mini");
    expect(model).toBeDefined();
    expect(model?.supportsVision).toBe(true);
    expect(model?.contextWindow).toBe(400000);
  });

  it("should include gpt-5.4-nano", () => {
    const model = INIAD_MODELS.find((m) => m.id === "gpt-5.4-nano");
    expect(model).toBeDefined();
    expect(model?.supportsVision).toBe(true);
    expect(model?.supportsTools).toBe(true);
    expect(model?.contextWindow).toBe(400000);
  });
});
