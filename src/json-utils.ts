import type { Json } from "./types";

/**
 * Parse JSON with error handling (generic).
 * Returns a discriminated union indicating success or failure.
 */
export function tryParseJSONObject<T extends Json = Json>(
  text: string
): { ok: true; value: T } | { ok: false; error: string } {
  if (!text || !text.trim()) {
    return { ok: false, error: "Empty string" };
  }
  try {
    const value = JSON.parse(text) as T;
    return { ok: true, value };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
