/// <reference types="jest" />

import * as vscode from "vscode";

import { IniadChatModelProvider } from "../src/provider";
import { secrets } from "../__mocks__/vscode";

function createDoneStream(): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("data: [DONE]\n"));
      controller.close();
    },
  });
}

function createToken(): vscode.CancellationToken {
  return {
    isCancellationRequested: false,
    onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
  } as unknown as vscode.CancellationToken;
}

function getLastRequestBody(): Record<string, unknown> {
  const fetchMock = global.fetch as unknown as {
    mock: { calls: unknown[][] };
  };
  const firstCall = fetchMock.mock.calls[0];
  if (!Array.isArray(firstCall) || firstCall.length < 2) {
    throw new Error("fetch call args not found");
  }

  const requestInit = firstCall[1];
  if (typeof requestInit !== "object" || requestInit === null) {
    return {};
  }

  const body = (requestInit as { body?: unknown }).body;
  if (typeof body !== "string") {
    return {};
  }

  const parsed: unknown = JSON.parse(body);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return {};
  }

  return parsed as Record<string, unknown>;
}

function extractToolNames(body: Record<string, unknown>): string[] {
  const tools = body.tools;
  if (!Array.isArray(tools)) {
    return [];
  }

  return tools
    .map((tool) => {
      if (typeof tool !== "object" || tool === null) {
        return undefined;
      }
      const fn = (tool as { function?: unknown }).function;
      if (typeof fn !== "object" || fn === null) {
        return undefined;
      }
      const name = (fn as { name?: unknown }).name;
      return typeof name === "string" ? name : undefined;
    })
    .filter((name): name is string => typeof name === "string");
}

describe("IniadChatModelProvider", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(secrets.get).mockResolvedValue("test-api-key");
    jest.mocked(vscode.workspace.getConfiguration).mockReturnValue({
      get: jest.fn((_key: string, defaultValue: unknown) => defaultValue),
    });
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      body: createDoneStream(),
    });
  });

  it("should expose the full context window as maxInputTokens", async () => {
    const provider = new IniadChatModelProvider(
      secrets as unknown as vscode.SecretStorage,
      "jest-agent",
    );

    const models = await provider.provideLanguageModelChatInformation(
      { silent: true } as vscode.PrepareLanguageModelChatModelOptions,
      createToken(),
    );

    const mini = models.find((m) => m.id === "gpt-5.4-mini");
    expect(mini).toBeDefined();
    expect(mini?.maxInputTokens).toBe(400000);
    expect(mini?.maxOutputTokens).toBe(131072);
  });

  it("should allow prompts within the context window", async () => {
    const provider = new IniadChatModelProvider(
      secrets as unknown as vscode.SecretStorage,
      "jest-agent",
    );
    const models = await provider.provideLanguageModelChatInformation(
      { silent: true } as vscode.PrepareLanguageModelChatModelOptions,
      createToken(),
    );
    const mini = models.find((m) => m.id === "gpt-5.4-mini");
    if (!mini) {
      throw new Error("gpt-5.4-mini not found");
    }

    const largePrompt = "a".repeat(30000 * 4);
    const messages = [vscode.LanguageModelChatMessage.User(largePrompt)];
    const progress = {
      report: jest.fn(),
    } as unknown as vscode.Progress<vscode.LanguageModelResponsePart>;

    await expect(
      provider.provideLanguageModelChatResponse(
        mini,
        messages,
        {},
        progress,
        createToken(),
      ),
    ).resolves.toBeUndefined();

    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("should use the default max_tokens when not specified", async () => {
    const provider = new IniadChatModelProvider(
      secrets as unknown as vscode.SecretStorage,
      "jest-agent",
    );
    const models = await provider.provideLanguageModelChatInformation(
      { silent: true } as vscode.PrepareLanguageModelChatModelOptions,
      createToken(),
    );
    const mini = models.find((m) => m.id === "gpt-5.4-mini");
    if (!mini) {
      throw new Error("gpt-5.4-mini not found");
    }

    const messages = [vscode.LanguageModelChatMessage.User("hello")];
    const progress = {
      report: jest.fn(),
    } as unknown as vscode.Progress<vscode.LanguageModelResponsePart>;

    await provider.provideLanguageModelChatResponse(
      mini,
      messages,
      {},
      progress,
      createToken(),
    );

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const requestBody = getLastRequestBody();
    expect(requestBody.max_completion_tokens).toBe(4096);
  });

  it("should reject prompts that exceed the documented context window", async () => {
    const provider = new IniadChatModelProvider(
      secrets as unknown as vscode.SecretStorage,
      "jest-agent",
    );
    const models = await provider.provideLanguageModelChatInformation(
      { silent: true } as vscode.PrepareLanguageModelChatModelOptions,
      createToken(),
    );
    const mini = models.find((m) => m.id === "gpt-5.4-mini");
    if (!mini) {
      throw new Error("gpt-5.4-mini not found");
    }

    const tooLargePrompt = "a".repeat(400001 * 4);
    const messages = [vscode.LanguageModelChatMessage.User(tooLargePrompt)];
    const progress = {
      report: jest.fn(),
    } as unknown as vscode.Progress<vscode.LanguageModelResponsePart>;

    await expect(
      provider.provideLanguageModelChatResponse(
        mini,
        messages,
        {},
        progress,
        createToken(),
      ),
    ).rejects.toThrow("Message exceeds token limit.");

    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("should filter blocked tools from the request (hardcoded patterns)", async () => {
    const provider = new IniadChatModelProvider(
      secrets as unknown as vscode.SecretStorage,
      "jest-agent",
    );
    const models = await provider.provideLanguageModelChatInformation(
      { silent: true } as vscode.PrepareLanguageModelChatModelOptions,
      createToken(),
    );
    const gpt54 = models.find((m) => m.id === "gpt-5.4");
    if (!gpt54) {
      throw new Error("gpt-5.4 not found");
    }

    const messages = [vscode.LanguageModelChatMessage.User("hello")];
    const progress = {
      report: jest.fn(),
    } as unknown as vscode.Progress<vscode.LanguageModelResponsePart>;

    const tools = [
      { name: "copilot_editFiles", description: "Edit", inputSchema: {} },
      { name: "copilot_readFile", description: "Read", inputSchema: {} },
      { name: "copilot_createFile", description: "Create", inputSchema: {} },
      {
        name: "copilot_runNotebookCell",
        description: "Run cell",
        inputSchema: {},
      },
      { name: "copilot_viewImage", description: "View image", inputSchema: {} },
    ] as vscode.LanguageModelChatTool[];

    const options = {
      tools,
      toolMode: vscode.LanguageModelChatToolMode.Auto,
    } as vscode.ProvideLanguageModelChatResponseOptions;

    await provider.provideLanguageModelChatResponse(
      gpt54,
      messages,
      options,
      progress,
      createToken(),
    );

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const requestBody = getLastRequestBody();
    // editFiles, createFile, runNotebookCell are blocked; readFile and viewImage remain
    const toolNames = extractToolNames(requestBody);
    expect(toolNames).toEqual(["copilot_readFile", "copilot_viewImage"]);
  });

  it("should allow non-blocked tools to pass through", async () => {
    const provider = new IniadChatModelProvider(
      secrets as unknown as vscode.SecretStorage,
      "jest-agent",
    );
    const models = await provider.provideLanguageModelChatInformation(
      { silent: true } as vscode.PrepareLanguageModelChatModelOptions,
      createToken(),
    );
    const gpt54 = models.find((m) => m.id === "gpt-5.4");
    if (!gpt54) {
      throw new Error("gpt-5.4 not found");
    }

    const messages = [vscode.LanguageModelChatMessage.User("hello")];
    const progress = {
      report: jest.fn(),
    } as unknown as vscode.Progress<vscode.LanguageModelResponsePart>;

    const tools = [
      { name: "copilot_readFile", description: "Read", inputSchema: {} },
      { name: "copilot_viewImage", description: "View", inputSchema: {} },
    ] as vscode.LanguageModelChatTool[];

    const options = {
      tools,
      toolMode: vscode.LanguageModelChatToolMode.Auto,
    } as vscode.ProvideLanguageModelChatResponseOptions;

    await provider.provideLanguageModelChatResponse(
      gpt54,
      messages,
      options,
      progress,
      createToken(),
    );

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const requestBody = getLastRequestBody();
    const toolNames = extractToolNames(requestBody);
    expect(toolNames).toEqual(["copilot_readFile", "copilot_viewImage"]);
  });
});
