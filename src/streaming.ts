import type { CancellationToken } from "vscode";

/**
 * Callbacks for SSE stream processing events.
 */
export interface SseStreamCallbacks<T> {
  /** Called for each parsed SSE data object */
  onData: (parsed: T) => void;
  /** Called when [DONE] signal is received */
  onDone: () => void;
}

/**
 * Read and parse an SSE (Server-Sent Events) stream, invoking callbacks for each event.
 *
 * @param responseBody The readable stream body from a fetch response.
 * @param token Cancellation token to abort reading.
 * @param parse Function to parse a raw JSON string into the expected type.
 * @param callbacks Handlers for parsed data and stream completion.
 */
export async function processSseStream<T>(
  responseBody: ReadableStream<Uint8Array>,
  token: CancellationToken,
  parse: (raw: string) => T,
  callbacks: SseStreamCallbacks<T>
): Promise<void> {
  const reader = responseBody.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (!token.isCancellationRequested) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) {
          continue;
        }
        const data = line.slice(6);
        if (data === "[DONE]") {
          callbacks.onDone();
          continue;
        }

        try {
          const parsed = parse(data);
          callbacks.onData(parsed);
        } catch {
          // Silently ignore malformed SSE lines
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Callbacks for Anthropic SSE stream processing events.
 */
export interface AnthropicSseStreamCallbacks<T> {
  /** Called for each parsed SSE data object with its event type */
  onData: (eventType: string, parsed: T) => void;
  /** Called when the stream is complete (message_stop) */
  onDone: () => void;
}

/**
 * Read and parse an Anthropic SSE stream.
 *
 * Anthropic SSE differs from OpenAI: each event has an `event: <type>` line
 * followed by `data: <json>`, and uses `message_stop` instead of `[DONE]`.
 */
export async function processAnthropicSseStream<T>(
  responseBody: ReadableStream<Uint8Array>,
  token: CancellationToken,
  parse: (raw: string) => T,
  callbacks: AnthropicSseStreamCallbacks<T>
): Promise<void> {
  const reader = responseBody.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let currentEventType = "";

  try {
    while (!token.isCancellationRequested) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (line.startsWith("event: ")) {
          currentEventType = line.slice(7).trim();
          continue;
        }

        if (!line.startsWith("data: ")) {
          continue;
        }

        const data = line.slice(6);

        try {
          const parsed = parse(data);
          callbacks.onData(currentEventType, parsed);

          if (currentEventType === "message_stop") {
            callbacks.onDone();
          }
        } catch {
          // Silently ignore malformed SSE lines
        }

        currentEventType = "";
      }
    }
  } finally {
    reader.releaseLock();
  }
}
