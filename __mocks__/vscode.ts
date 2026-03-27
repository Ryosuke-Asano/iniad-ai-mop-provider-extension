/// <reference types="jest" />
/**
 * Mock for VS Code API
 * This provides minimal implementations for testing purposes
 */

import type { Json } from "../src/types";

export enum LanguageModelChatMessageRole {
  System = 0,
  User = 1,
  Assistant = 2,
}

export class LanguageModelTextPart {
  constructor(public readonly value: string) {}
}

export class LanguageModelDataPart {
  public readonly mimeType: string;
  public readonly data: Uint8Array;

  constructor(data: Uint8Array, mimeType: string) {
    this.mimeType = mimeType;
    this.data = data;
  }

  static image(data: Uint8Array, mime: string): LanguageModelDataPart {
    return new LanguageModelDataPart(data, mime);
  }

  static json(value: Json, mime?: string): LanguageModelDataPart {
    const text = typeof value === "string" ? value : JSON.stringify(value);
    const encoder = new TextEncoder();
    const data = encoder.encode(text);
    return new LanguageModelDataPart(data, mime || "application/json");
  }

  static text(value: string, mime?: string): LanguageModelDataPart {
    const encoder = new TextEncoder();
    const data = encoder.encode(value);
    return new LanguageModelDataPart(data, mime || "text/plain");
  }
}

export class LanguageModelPromptTsxPart {
  constructor(public readonly value: Json) {}
}

export class LanguageModelToolCallPart {
  constructor(
    public readonly callId: string,
    public readonly name: string,
    public readonly input: object
  ) {}
}

export class LanguageModelToolResultPart {
  constructor(
    public readonly callId: string,
    public readonly content: Array<
      | LanguageModelTextPart
      | LanguageModelPromptTsxPart
      | LanguageModelDataPart
      | Json
    >
  ) {}
}

export enum LanguageModelChatToolMode {
  Auto = 1,
  Required = 2,
}

export type LanguageModelInputPart =
  | LanguageModelTextPart
  | LanguageModelToolResultPart
  | LanguageModelToolCallPart
  | LanguageModelDataPart;

export class LanguageModelChatMessage {
  role: LanguageModelChatMessageRole;
  content: LanguageModelInputPart[];
  name: string | undefined;

  constructor(
    role: LanguageModelChatMessageRole,
    content: string | LanguageModelInputPart[],
    name?: string
  ) {
    this.role = role;
    this.name = name;

    if (typeof content === "string") {
      this.content = [new LanguageModelTextPart(content)];
    } else if (
      Array.isArray(content) &&
      content.length > 0 &&
      typeof content[0] === "string"
    ) {
      this.content = (content as unknown as string[]).map(
        (c) => new LanguageModelTextPart(c)
      );
    } else {
      this.content = content as LanguageModelInputPart[];
    }
  }

  static User(content: string | LanguageModelInputPart[]): LanguageModelChatMessage {
    return new LanguageModelChatMessage(
      LanguageModelChatMessageRole.User,
      content
    );
  }

  static Assistant(
    content: string | LanguageModelInputPart[]
  ): LanguageModelChatMessage {
    return new LanguageModelChatMessage(
      LanguageModelChatMessageRole.Assistant,
      content
    );
  }

  static System(content: string | LanguageModelInputPart[]): LanguageModelChatMessage {
    return new LanguageModelChatMessage(
      LanguageModelChatMessageRole.System,
      content
    );
  }
}

// Type aliases needed by tests
export interface CancellationToken {
  isCancellationRequested: boolean;
  onCancellationRequested: (listener: () => void) => { dispose(): void };
}

export interface PrepareLanguageModelChatModelOptions {
  silent?: boolean;
}

export interface ProvideLanguageModelChatResponseOptions {
  tools?: LanguageModelChatTool[];
  toolMode?: LanguageModelChatToolMode;
  modelOptions?: Record<string, unknown>;
}

export interface LanguageModelChatTool {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

export interface LanguageModelResponsePart {}

export interface Progress<T> {
  report(value: T): void;
}

// Types needed by src/provider.ts
export interface LanguageModelChatInformation {
  id: string;
  name: string;
  tooltip?: string;
  family?: string;
  version?: string;
  maxInputTokens: number;
  maxOutputTokens: number;
  capabilities?: {
    toolCalling?: number | false;
    imageInput?: boolean;
  };
}

export interface LanguageModelChatProvider {
  onDidChangeLanguageModelChatInformation: Event<void>;
  provideLanguageModelChatInformation(
    options: PrepareLanguageModelChatModelOptions,
    token: CancellationToken
  ): Promise<LanguageModelChatInformation[]>;
  provideLanguageModelChatResponse(
    model: LanguageModelChatInformation,
    messages: readonly LanguageModelChatMessage[],
    options: ProvideLanguageModelChatResponseOptions,
    progress: Progress<LanguageModelResponsePart>,
    token: CancellationToken
  ): Promise<void>;
  provideTokenCount(
    model: LanguageModelChatInformation,
    text: string | LanguageModelChatMessage,
    token: CancellationToken
  ): Promise<number>;
}

export type Event<T> = (
  listener: (e: T) => any,
  thisArgs?: any,
  disposables?: { push(d: { dispose(): void }): void }
) => { dispose(): void };

export const secrets = {
  get: jest.fn(),
  store: jest.fn(),
  delete: jest.fn(),
  onDidChange: jest.fn(() => ({
    dispose: jest.fn(),
  })),
};

export const workspace = {
  getConfiguration: jest.fn(),
};

export const window = {
  showInputBox: jest.fn(),
  showInformationMessage: jest.fn(),
};

export const commands = {
  registerCommand: jest.fn(),
};

export const lm = {
  registerLanguageModelChatProvider: jest.fn(),
  registerTool: jest.fn(),
};

export const Disposable = {
  from: jest.fn(() => ({
    dispose: jest.fn(),
  })),
};

export const LanguageModelError = {
  NoPermissions: (message?: string) => {
    const err = new Error(message);
    err.name = "LanguageModelError";
    return err;
  },
  NotFound: (message?: string) => {
    const err = new Error(message);
    err.name = "LanguageModelError";
    return err;
  },
  Blocked: (message?: string) => {
    const err = new Error(message);
    err.name = "LanguageModelError";
    return err;
  },
};

export const CancellationError = class extends Error {
  constructor() {
    super("Operation cancelled");
    this.name = "CancellationError";
  }
};

export class SecretStorage {
  get = jest.fn();
  store = jest.fn();
  delete = jest.fn();
  onDidChange = jest.fn(() => ({ dispose: jest.fn() }));
}

export class LanguageModelToolResult {
  constructor(public parts: readonly LanguageModelTextPart[]) {}
}

export class EventEmitter<T> {
  event: jest.Mock;
  fire: jest.Mock;

  constructor() {
    this.event = jest.fn();
    this.fire = jest.fn();
  }
}
