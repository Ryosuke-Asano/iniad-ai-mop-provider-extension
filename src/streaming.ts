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
