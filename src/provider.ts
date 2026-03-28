import * as vscode from "vscode";
import {
  CancellationToken,
  LanguageModelChatInformation,
  LanguageModelChatMessage,
  LanguageModelChatProvider,
  ProvideLanguageModelChatResponseOptions,
  LanguageModelResponsePart,
  Progress,
  PrepareLanguageModelChatModelOptions,
  EventEmitter,
  Event,
} from "vscode";

import type {
  IniadModelInfo,
  IniadStreamResponse,
  IniadRequestBody,
  Json,
} from "./types";
import { INIAD_MODELS } from "./types";
import {
  convertMessages,
  convertTools,
  validateRequest,
  estimateMessagesTokens,
  getTextPartValue,
  extractImageData,
} from "./utils";
import { IniadVisionApiClient } from "./vision-api-client";
import { ToolCallStateMachine } from "./tool-call-buffer";
import { processSseStream, processAnthropicSseStream } from "./streaming";
import {
  BASE_URL,
  ANTHROPIC_BASE_URL,
  MAX_TOOL_RESULT_CHARS,
  MAX_TOOLS_PER_REQUEST,
  DEFAULT_MAX_TOKENS,
} from "./constants";
import {
  convertMessagesAnthropic,
  convertToolsAnthropic,
  processAnthropicDelta,
  AnthropicStreamEvent,
  AnthropicRequestBody,
} from "./anthropic";

/**
 * VS Code Chat provider backed by INIAD AI MOP API (OpenAI + Anthropic compatible).
 */
export class IniadChatModelProvider implements LanguageModelChatProvider {
  /** Debug counter */
  private _debugCallCount = 0;

  /** Event emitter for model information changes */
  private readonly _onDidChangeLanguageModelChatInformation =
    new EventEmitter<void>();

  /** Event that fires when available language models change */
  readonly onDidChangeLanguageModelChatInformation: Event<void> =
    this._onDidChangeLanguageModelChatInformation.event;

  /**
   * Fire the onDidChangeLanguageModelChatInformation event
   * Call this when the list of available models changes
   */
  fireModelInfoChanged(): void {
    this._onDidChangeLanguageModelChatInformation.fire();
  }

  /**
   * Convert HTTP status codes from upstream to LanguageModelError when possible.
   */
  private toLanguageModelError(
    status: number,
    statusText: string,
    details: string,
  ): Error {
    const message = `INIAD API error: ${status} ${statusText}${details ? `\n${details}` : ""}`;
    if (status === 401 || status === 403) {
      return vscode.LanguageModelError.NoPermissions(message);
    }
    if (status === 404) {
      return vscode.LanguageModelError.NotFound(message);
    }
    if (status === 429) {
      return vscode.LanguageModelError.Blocked(message);
    }
    return new Error(message);
  }

  /** MCP client for image processing fallback */
  private _visionClient: IniadVisionApiClient;

  /**
   * Create a provider using the given secret storage for the API key.
   * @param secrets VS Code secret storage.
   * @param userAgent User agent string for API requests.
   */
  constructor(
    private readonly secrets: vscode.SecretStorage,
    private readonly userAgent: string,
  ) {
    this._visionClient = new IniadVisionApiClient(secrets);
  }

  /**
   * Get the list of available language models contributed by this provider
   * @param options Options which specify the calling context of this function
   * @param token A cancellation token which signals if the user cancelled the request or not
   * @returns A promise that resolves to the list of available language models
   */
  async provideLanguageModelChatInformation(
    options: PrepareLanguageModelChatModelOptions,
    _token: CancellationToken,
  ): Promise<LanguageModelChatInformation[]> {
    this._debugCallCount++;
    const apiKey = await this.ensureApiKey(options.silent ?? false);
    if (!apiKey) {
      return [];
    }

    return INIAD_MODELS.map((model: IniadModelInfo) => ({
      id: model.id,
      name: model.displayName,
      tooltip: `INIAD AI MOP ${model.name}`,
      family: "iniad",
      version: "1.0.0",
      maxInputTokens: Math.max(1, model.contextWindow),
      maxOutputTokens: model.maxOutput,
      capabilities: {
        toolCalling: model.supportsTools ? MAX_TOOLS_PER_REQUEST : false,
        imageInput: true, // Image input allowed; non-vision models auto-route
      },
    }));
  }

  /**
   * Check if model supports vision natively
   */
  private modelSupportsVision(modelId: string): boolean {
    const modelInfo = INIAD_MODELS.find((m) => m.id === modelId);
    return modelInfo?.supportsVision ?? false;
  }

  /**
   * Pick a fallback vision model for image input
   */
  private getVisionFallbackModelId(): string | undefined {
    // Use OpenAI models for vision fallback (Anthropic models have native vision)
    const preferred = INIAD_MODELS.find(
      (m) =>
        m.id === "gpt-5.4-nano" && m.supportsVision && m.provider === "openai",
    );
    if (preferred) {
      return preferred.id;
    }
    return INIAD_MODELS.find((m) => m.supportsVision && m.provider === "openai")
      ?.id;
  }

  /**
   * Check if any message contains image input parts
   */
  private hasImageInput(
    messages: readonly LanguageModelChatMessage[],
  ): boolean {
    for (const msg of messages) {
      for (const part of msg.content) {
        if (extractImageData(part)) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Get model info by id
   */
  private getModelInfo(modelId: string): IniadModelInfo | undefined {
    return INIAD_MODELS.find((m) => m.id === modelId);
  }

  /**
   * Rough token estimate for tool definitions by JSON size.
   */
  private estimateToolTokens(tools: IniadRequestBody["tools"]): number {
    if (!tools || tools.length === 0) {
      return 0;
    }
    try {
      return Math.ceil(JSON.stringify(tools).length / 4);
    } catch {
      return 0;
    }
  }

  /**
   * Pre-process messages to handle images for non-vision models
   * Converts images to text descriptions using GPT-4o-mini via INIAD API
   */
  private async processImagesForNonVisionModel(
    messages: readonly LanguageModelChatMessage[],
    _modelId: string,
    token: CancellationToken,
  ): Promise<{
    processedMessages: LanguageModelChatMessage[];
    imageDescriptions: string[];
  }> {
    const imageDescriptions: string[] = [];
    const processedMessages: LanguageModelChatMessage[] = [];

    for (const msg of messages) {
      // Extract text from message
      const textParts: string[] = [];
      for (const part of msg.content) {
        const v = getTextPartValue(part);
        if (v !== undefined) {
          textParts.push(v);
        }
      }

      const userPrompt = textParts.join(" ");

      // Extract image data parts
      const images: Array<{ mimeType: string; data: Uint8Array }> = [];
      for (const part of msg.content) {
        const img = extractImageData(part);
        if (img) {
          images.push(img);
        }
      }

      if (images.length === 0) {
        // No images, keep message as-is
        processedMessages.push(msg);
        continue;
      }

      // Analyze images for this message
      const thisMessageDescriptions: string[] = [];
      for (const img of images) {
        if (token.isCancellationRequested) {
          throw new vscode.CancellationError();
        }

        const base64Data = Buffer.from(img.data).toString("base64");
        const imageDataUrl = `data:${img.mimeType};base64,${base64Data}`;

        const analysisPrompt = userPrompt || "Describe this image in detail.";
        const description = await this._visionClient.analyzeImage(
          imageDataUrl,
          analysisPrompt,
        );
        thisMessageDescriptions.push(description);
      }

      // Replace image with text description for non-Vision model
      const newContent: vscode.LanguageModelTextPart[] = [];
      for (const textPart of textParts) {
        newContent.push(new vscode.LanguageModelTextPart(textPart));
      }

      // Add image descriptions as text
      if (thisMessageDescriptions.length > 0) {
        newContent.push(
          new vscode.LanguageModelTextPart(
            `\n\n[Image Analysis]:\n${thisMessageDescriptions.join("\n\n---\n\n")}`,
          ),
        );
      }

      processedMessages.push(vscode.LanguageModelChatMessage.User(newContent));
    }

    return { processedMessages, imageDescriptions };
  }

  /**
   * Returns the response for a chat request, passing the results to the progress callback.
   * @param model The language model to use
   * @param messages The messages to include in the request
   * @param options Options for the request
   * @param progress The progress to emit the streamed response chunks to
   * @param token A cancellation token for the request
   * @returns A promise that resolves when the response is complete.
   */
  async provideLanguageModelChatResponse(
    model: LanguageModelChatInformation,
    messages: readonly LanguageModelChatMessage[],
    options: ProvideLanguageModelChatResponseOptions,
    progress: Progress<LanguageModelResponsePart>,
    token: CancellationToken,
  ): Promise<void> {
    // Create per-request tool call state machine
    const toolCallState = new ToolCallStateMachine();
    const abortController = new AbortController();
    const cancellationSubscription = token.onCancellationRequested(() => {
      abortController.abort();
    });

    const trackingProgress: Progress<LanguageModelResponsePart> = {
      report: (part) => {
        try {
          progress.report(part);
        } catch (e) {
          console.error("[INIAD Model Provider] Progress.report failed", {
            modelId: model.id,
            error:
              e instanceof Error
                ? { name: e.name, message: e.message }
                : String(e),
          });
        }
      },
    };

    try {
      const apiKey = await this.ensureApiKey(true);
      if (!apiKey) {
        throw vscode.LanguageModelError.NoPermissions(
          "INIAD API key not found",
        );
      }

      const hasImages = this.hasImageInput(messages);
      let processedMessages = messages;
      let effectiveModelId = model.id;

      if (hasImages) {
        if (!this.modelSupportsVision(model.id)) {
          const visionFallback = this.getVisionFallbackModelId();
          if (visionFallback && visionFallback !== model.id) {
            console.warn(
              "[INIAD Model Provider] Switching to vision model for image input",
              {
                originalModel: model.id,
                visionModel: visionFallback,
              },
            );
            effectiveModelId = visionFallback;
          } else {
            console.warn(
              "[INIAD Model Provider] No vision model available, using OCR fallback",
            );
            const result = await this.processImagesForNonVisionModel(
              messages,
              model.id,
              token,
            );
            processedMessages = result.processedMessages;
          }
        }
      }

      if (options.tools && options.tools.length > MAX_TOOLS_PER_REQUEST) {
        throw new Error(
          `Cannot have more than ${MAX_TOOLS_PER_REQUEST} tools per request.`,
        );
      }

      validateRequest(processedMessages);

      const effectiveModelInfo = this.getModelInfo(effectiveModelId);

      if (effectiveModelInfo?.provider === "anthropic") {
        await this.executeAnthropicRequest(
          effectiveModelId,
          processedMessages,
          options,
          model,
          trackingProgress,
          token,
          toolCallState,
          apiKey,
          abortController,
        );
      } else {
        await this.executeOpenAiRequest(
          effectiveModelId,
          processedMessages,
          options,
          model,
          trackingProgress,
          token,
          toolCallState,
          apiKey,
          abortController,
        );
      }
    } catch (err) {
      if (
        token.isCancellationRequested ||
        (err instanceof Error && err.name === "AbortError")
      ) {
        throw new vscode.CancellationError();
      }
      console.error("[INIAD Model Provider] Chat request failed", {
        modelId: model.id,
        messageCount: messages.length,
        error:
          err instanceof Error
            ? { name: err.name, message: err.message }
            : String(err),
      });
      throw err;
    } finally {
      cancellationSubscription.dispose();
    }
  }

  /**
   * Returns the number of tokens for a given text using the model specific tokenizer logic
   * @param model The language model to use
   * @param text The text to count tokens for
   * @param token A cancellation token for the request
   * @returns A promise that resolves to the number of tokens
   */
  provideTokenCount(
    _model: LanguageModelChatInformation,
    text: string | LanguageModelChatMessage,
    _token: CancellationToken,
  ): Promise<number> {
    if (typeof text === "string") {
      return Promise.resolve(Math.ceil(text.length / 4));
    } else {
      let totalTokens = 0;
      for (const part of text.content) {
        const tv = getTextPartValue(part);
        if (tv !== undefined) {
          totalTokens += Math.ceil(tv.length / 4);
          continue;
        }
        const img = extractImageData(part);
        if (img) {
          // Rough estimate: images typically cost ~1000-2000 tokens
          totalTokens += 1500;
        }
      }
      return Promise.resolve(totalTokens);
    }
  }

  /**
   * Ensure an API key exists in SecretStorage, optionally prompting the user when not silent.
   * @param silent If true, do not prompt the user.
   */
  private async ensureApiKey(silent: boolean): Promise<string | undefined> {
    let apiKey = await this.secrets.get("iniad.apiKey");
    if (!apiKey && !silent) {
      const entered = await vscode.window.showInputBox({
        title: "INIAD AI MOP API Key",
        prompt:
          "Enter your INIAD API key (obtain via 'apikey issue' command in GPT-4o mini bot)",
        ignoreFocusOut: true,
        password: true,
      });
      if (entered && entered.trim()) {
        apiKey = entered.trim();
        await this.secrets.store("iniad.apiKey", apiKey);
      }
    }
    return apiKey;
  }

  /**
   * Execute a chat request against the OpenAI-compatible endpoint.
   */
  private async executeOpenAiRequest(
    effectiveModelId: string,
    processedMessages: readonly LanguageModelChatMessage[],
    options: ProvideLanguageModelChatResponseOptions,
    model: LanguageModelChatInformation,
    progress: Progress<LanguageModelResponsePart>,
    token: CancellationToken,
    toolCallState: ToolCallStateMachine,
    apiKey: string,
    abortController: AbortController,
  ): Promise<void> {
    const toolConfig = convertTools(options);
    const iniadMessages = convertMessages(processedMessages, {
      maxToolResultChars: MAX_TOOL_RESULT_CHARS,
    });

    const inputTokenCount = estimateMessagesTokens(processedMessages, {
      maxToolResultChars: MAX_TOOL_RESULT_CHARS,
    });
    const toolTokenCount = this.estimateToolTokens(toolConfig.tools);
    const effectiveModelInfo = this.getModelInfo(effectiveModelId);
    const mo = options.modelOptions as Record<string, Json> | undefined;
    const maxTokensVal =
      typeof mo?.max_tokens === "number" ? mo.max_tokens : DEFAULT_MAX_TOKENS;
    const temperatureVal =
      typeof mo?.temperature === "number" ? mo.temperature : undefined;
    const effectiveMaxOutputTokens =
      effectiveModelInfo?.maxOutput ?? model.maxOutputTokens;
    const requestedMaxTokens = Math.min(maxTokensVal, effectiveMaxOutputTokens);
    const tokenLimit = Math.max(
      1,
      effectiveModelInfo
        ? effectiveModelInfo.contextWindow
        : model.maxInputTokens,
    );
    const totalEstimatedTokens = inputTokenCount + toolTokenCount;
    if (totalEstimatedTokens > tokenLimit) {
      console.error("[INIAD Model Provider] Message exceeds token limit", {
        total: totalEstimatedTokens,
        messageTokens: inputTokenCount,
        toolTokens: toolTokenCount,
        tokenLimit,
        requestedMaxTokens,
      });
      throw new Error("Message exceeds token limit.");
    }
    const requestBody: IniadRequestBody = {
      model: effectiveModelId,
      messages: iniadMessages,
      stream: true,
      max_completion_tokens: requestedMaxTokens,
    };

    // Only send temperature when explicitly provided — some models (e.g. o4-mini)
    // only accept the default value and reject custom values like 0.7.
    if (temperatureVal !== undefined) {
      requestBody.temperature = temperatureVal;
    }

    if (mo) {
      if (typeof mo.stop === "string") {
        requestBody.stop = mo.stop;
      } else if (
        Array.isArray(mo.stop) &&
        mo.stop.every((s) => typeof s === "string")
      ) {
        requestBody.stop = mo.stop;
      }
      if (typeof mo.frequency_penalty === "number") {
        requestBody.frequency_penalty = mo.frequency_penalty;
      }
      if (typeof mo.presence_penalty === "number") {
        requestBody.presence_penalty = mo.presence_penalty;
      }
    }

    if (toolConfig.tools) {
      requestBody.tools = toolConfig.tools;
    }
    if (toolConfig.tool_choice) {
      requestBody.tool_choice = toolConfig.tool_choice;
    }

    if (token.isCancellationRequested) {
      throw new vscode.CancellationError();
    }
    const response = await fetch(`${BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "User-Agent": this.userAgent,
      },
      signal: abortController.signal,
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[INIAD Model Provider] API error response", errorText);
      throw this.toLanguageModelError(
        response.status,
        response.statusText,
        errorText,
      );
    }

    if (!response.body) {
      throw new Error("No response body from INIAD API");
    }

    await this.processOpenAiStreamingResponse(
      response.body,
      progress,
      token,
      toolCallState,
    );
  }

  /**
   * Execute a chat request against the Anthropic-compatible endpoint.
   */
  private async executeAnthropicRequest(
    effectiveModelId: string,
    processedMessages: readonly LanguageModelChatMessage[],
    options: ProvideLanguageModelChatResponseOptions,
    model: LanguageModelChatInformation,
    progress: Progress<LanguageModelResponsePart>,
    token: CancellationToken,
    toolCallState: ToolCallStateMachine,
    apiKey: string,
    abortController: AbortController,
  ): Promise<void> {
    const { system, messages: anthropicMessages } = convertMessagesAnthropic(
      processedMessages,
      {
        maxToolResultChars: MAX_TOOL_RESULT_CHARS,
      },
    );
    const toolConfig = convertToolsAnthropic(options);

    const mo = options.modelOptions as Record<string, Json> | undefined;
    const maxTokensVal =
      typeof mo?.max_tokens === "number" ? mo.max_tokens : DEFAULT_MAX_TOKENS;
    const effectiveModelInfo = this.getModelInfo(effectiveModelId);
    const effectiveMaxOutputTokens =
      effectiveModelInfo?.maxOutput ?? model.maxOutputTokens;
    const requestedMaxTokens = Math.min(maxTokensVal, effectiveMaxOutputTokens);

    const requestBody: AnthropicRequestBody = {
      model: effectiveModelId,
      max_tokens: requestedMaxTokens,
      stream: true,
      messages: anthropicMessages,
    };

    if (system) {
      requestBody.system = system;
    }

    const temperatureVal =
      typeof mo?.temperature === "number" ? mo.temperature : undefined;
    if (temperatureVal !== undefined) {
      requestBody.temperature = temperatureVal;
    }

    if (mo) {
      if (typeof mo.stop === "string") {
        requestBody.stop_sequences = [mo.stop];
      } else if (
        Array.isArray(mo.stop) &&
        mo.stop.every((s) => typeof s === "string")
      ) {
        requestBody.stop_sequences = mo.stop;
      }
    }

    if (toolConfig.tools) {
      requestBody.tools = toolConfig.tools;
    }
    if (toolConfig.tool_choice) {
      requestBody.tool_choice = toolConfig.tool_choice;
    }

    if (token.isCancellationRequested) {
      throw new vscode.CancellationError();
    }
    const response = await fetch(`${ANTHROPIC_BASE_URL}/messages`, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "Content-Type": "application/json",
        "User-Agent": this.userAgent,
        "anthropic-version": "2023-06-01",
      },
      signal: abortController.signal,
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(
        "[INIAD Model Provider] Anthropic API error response",
        errorText,
      );
      throw this.toLanguageModelError(
        response.status,
        response.statusText,
        errorText,
      );
    }

    if (!response.body) {
      throw new Error("No response body from Anthropic API");
    }

    await this.processAnthropicStreamingResponse(
      response.body,
      progress,
      token,
      toolCallState,
    );
  }

  /**
   * Read and parse an Anthropic streaming response.
   */
  private async processAnthropicStreamingResponse(
    responseBody: ReadableStream<Uint8Array>,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    token: vscode.CancellationToken,
    toolCallState: ToolCallStateMachine,
  ): Promise<void> {
    try {
      await processAnthropicSseStream<AnthropicStreamEvent>(
        responseBody,
        token,
        (raw) => JSON.parse(raw) as AnthropicStreamEvent,
        {
          onData: (_eventType, parsed) => {
            processAnthropicDelta(parsed, progress, toolCallState);
          },
          onDone: () => {
            toolCallState.flushToolCallBuffers(progress, false);
            toolCallState.flushActiveTextToolCall(progress);
          },
        },
      );
    } finally {
      toolCallState.reset();
    }
  }

  /**
   * Read and parse the OpenAI streaming (SSE) response and report parts.
   * @param responseBody The readable stream body.
   * @param progress Progress reporter for streamed parts.
   * @param token Cancellation token.
   */
  private async processOpenAiStreamingResponse(
    responseBody: ReadableStream<Uint8Array>,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    token: vscode.CancellationToken,
    toolCallState: ToolCallStateMachine,
  ): Promise<void> {
    try {
      await processSseStream<IniadStreamResponse>(
        responseBody,
        token,
        (raw) => JSON.parse(raw) as IniadStreamResponse,
        {
          onData: (parsed) => {
            this.processDelta(parsed, progress, toolCallState);
          },
          onDone: () => {
            toolCallState.flushToolCallBuffers(progress, false);
            toolCallState.flushActiveTextToolCall(progress);
          },
        },
      );
    } finally {
      toolCallState.reset();
    }
  }

  private processDelta(
    delta: IniadStreamResponse,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    toolCallState: ToolCallStateMachine,
  ): boolean {
    let emitted = false;
    const choice = delta.choices?.[0];
    if (!choice) {
      return false;
    }

    const deltaObj = choice.delta;

    // Handle text content
    if (deltaObj?.content) {
      const content = String(deltaObj.content);

      const textResult = toolCallState.processTextContent(content, progress);
      if (textResult.emittedText) {
        toolCallState.hasEmittedAssistantText = true;
      }
      if (textResult.emittedAny) {
        emitted = true;
      }
    }

    // Handle tool calls
    if (deltaObj?.tool_calls) {
      toolCallState.processStructuredToolCalls(deltaObj.tool_calls, progress);
    }

    toolCallState.handleFinishReason(choice.finish_reason, progress);

    return emitted;
  }
}
