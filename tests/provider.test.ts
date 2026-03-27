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

describe("IniadChatModelProvider", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (secrets.get as jest.Mock).mockResolvedValue("test-api-key");
    (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
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
      "jest-agent"
    );

    const models = await provider.provideLanguageModelChatInformation(
      { silent: true } as vscode.PrepareLanguageModelChatModelOptions,
      createToken()
    );

    const gpt54 = models.find((m) => m.id === "gpt-5.4");
    expect(gpt54).toBeDefined();
    expect(gpt54?.maxInputTokens).toBe(1000000);
    expect(gpt54?.maxOutputTokens).toBe(131072);
  });

  it("should allow prompts within the context window", async () => {
    const provider = new IniadChatModelProvider(
      secrets as unknown as vscode.SecretStorage,
      "jest-agent"
    );
    const models = await provider.provideLanguageModelChatInformation(
      { silent: true } as vscode.PrepareLanguageModelChatModelOptions,
      createToken()
    );
    const gpt54 = models.find((m) => m.id === "gpt-5.4");
    if (!gpt54) {
      throw new Error("gpt-5.4 not found");
    }

    const largePrompt = "a".repeat(30000 * 4);
    const messages = [vscode.LanguageModelChatMessage.User(largePrompt)];
    const progress = {
      report: jest.fn(),
    } as unknown as vscode.Progress<vscode.LanguageModelResponsePart>;

    await expect(
      provider.provideLanguageModelChatResponse(
        gpt54,
        messages,
        {},
        progress,
        createToken()
      )
    ).resolves.toBeUndefined();

    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("should use the default max_tokens when not specified", async () => {
    const provider = new IniadChatModelProvider(
      secrets as unknown as vscode.SecretStorage,
      "jest-agent"
    );
    const models = await provider.provideLanguageModelChatInformation(
      { silent: true } as vscode.PrepareLanguageModelChatModelOptions,
      createToken()
    );
    const gpt54 = models.find((m) => m.id === "gpt-5.4");
    if (!gpt54) {
      throw new Error("gpt-5.4 not found");
    }

    const messages = [vscode.LanguageModelChatMessage.User("hello")];
    const progress = {
      report: jest.fn(),
    } as unknown as vscode.Progress<vscode.LanguageModelResponsePart>;

    await provider.provideLanguageModelChatResponse(
      gpt54,
      messages,
      {},
      progress,
      createToken()
    );

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const requestInit = (global.fetch as jest.Mock).mock.calls[0]?.[1] as {
      body?: string;
    };
    expect(requestInit.body).toBeDefined();
    const requestBody = JSON.parse(requestInit.body ?? "{}");
    expect(requestBody.max_tokens).toBe(4096);
  });

  it("should reject prompts that exceed the documented context window", async () => {
    const provider = new IniadChatModelProvider(
      secrets as unknown as vscode.SecretStorage,
      "jest-agent"
    );
    const models = await provider.provideLanguageModelChatInformation(
      { silent: true } as vscode.PrepareLanguageModelChatModelOptions,
      createToken()
    );
    const gpt54nano = models.find((m) => m.id === "gpt-5.4-nano");
    if (!gpt54nano) {
      throw new Error("gpt-5.4-nano not found");
    }

    const tooLargePrompt = "a".repeat(400001 * 4);
    const messages = [vscode.LanguageModelChatMessage.User(tooLargePrompt)];
    const progress = {
      report: jest.fn(),
    } as unknown as vscode.Progress<vscode.LanguageModelResponsePart>;

    await expect(
      provider.provideLanguageModelChatResponse(
        gpt54nano,
        messages,
        {},
        progress,
        createToken()
      )
    ).rejects.toThrow("Message exceeds token limit.");

    expect(global.fetch).not.toHaveBeenCalled();
  });
});
