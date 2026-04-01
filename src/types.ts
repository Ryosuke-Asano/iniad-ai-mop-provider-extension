/**
 * Type definitions for INIAD AI MOP API compatibility
 * Based on OpenAI-compatible API format
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | Json[]
  | { [k: string]: Json };
export type JsonObject = { [k: string]: Json };

/**
 * Content part for chat messages
 */
export interface IniadContentPart {
  type: "text" | "image_url";
  text?: string;
  image_url?: {
    url: string;
    detail?: "auto" | "low" | "high";
  };
}

export interface IniadChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | IniadContentPart[];
  name?: string;
  tool_calls?: IniadToolCall[];
  tool_call_id?: string;
}

export interface IniadToolCall {
  id: string;
  /** Optional index used in streaming tool call deltas */
  index?: number;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface IniadTool {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: JsonObject;
  };
}

export interface IniadChatRequest {
  model: string;
  messages: IniadChatMessage[];
  temperature?: number;
  max_completion_tokens?: number;
  stream?: boolean;
  top_p?: number;
  stop?: string | string[];
  tools?: IniadTool[];
  tool_choice?: "auto" | "none" | { type: string; function: { name: string } };
}

export interface IniadChatChoice {
  index: number;
  message: {
    role: string;
    content: string | null;
    tool_calls?: IniadToolCall[];
  };
  finish_reason: string;
}

export interface IniadChatResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: IniadChatChoice[];
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface IniadStreamChoice {
  index: number;
  delta: {
    role?: string;
    content?: string;
    tool_calls?: IniadToolCall[];
  };
  finish_reason: string | null;
}

export interface IniadStreamResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: IniadStreamChoice[];
}

/**
 * Model information for INIAD AI MOP models
 */
export interface IniadModelInfo {
  id: string;
  name: string;
  displayName: string;
  contextWindow: number;
  maxOutput: number;
  supportsTools: boolean;
  supportsVision: boolean;
  provider: "openai" | "anthropic";
}

/**
 * A strongly-typed request body used for INIAD Chat API requests
 */
export interface IniadRequestBody {
  model: string;
  messages: IniadChatMessage[];
  stream?: boolean;
  max_completion_tokens?: number;
  temperature?: number;
  stop?: string | string[];
  frequency_penalty?: number;
  presence_penalty?: number;
  tools?: IniadTool[];
  tool_choice?: "auto" | "none" | { type: string; function: { name: string } };
}

/**
 * Available INIAD AI MOP models configuration
 */
export const INIAD_MODELS: IniadModelInfo[] = [
  // OpenAI models
  {
    id: "o4-mini",
    name: "o4-mini",
    displayName: "GPT-o4-mini",
    contextWindow: 200000,
    maxOutput: 100000,
    supportsTools: true,
    supportsVision: true,
    provider: "openai",
  },
  // GPT-5.4 family
  // NOTE: GPT-5.4 models are not yet available on INIAD.
  // Uncomment when INIAD adds GPT-5.4 support.
  {
    id: "gpt-5.4",
    name: "GPT-5.4",
    displayName: "GPT-5.4",
    contextWindow: 1000000,
    maxOutput: 131072,
    supportsTools: true,
    supportsVision: true,
    provider: "openai",
  },
  {
    id: "gpt-5.4-mini",
    name: "GPT-5.4 mini",
    displayName: "GPT-5.4 mini",
    contextWindow: 400000,
    maxOutput: 131072,
    supportsTools: true,
    supportsVision: true,
    provider: "openai",
  },
  {
    id: "gpt-5.4-nano",
    name: "GPT-5.4 nano",
    displayName: "GPT-5.4 nano",
    contextWindow: 400000,
    maxOutput: 131072,
    supportsTools: true,
    supportsVision: true,
    provider: "openai",
  },
  // Anthropic Claude family
  // NOTE: INIAD's Anthropic proxy does not yet support tools/tool_choice.
  {
    id: "claude-opus-4-6",
    name: "Claude Opus 4.6",
    displayName: "Claude Opus 4.6",
    contextWindow: 1000000,
    maxOutput: 128000,
    supportsTools: false,
    supportsVision: true,
    provider: "anthropic",
  },
  {
    id: "claude-sonnet-4-6",
    name: "Claude Sonnet 4.6",
    displayName: "Claude Sonnet 4.6",
    contextWindow: 1000000,
    maxOutput: 128000,
    supportsTools: false,
    supportsVision: true,
    provider: "anthropic",
  },
  {
    id: "claude-haiku-4-5",
    name: "Claude Haiku 4.5",
    displayName: "Claude Haiku 4.5",
    contextWindow: 200000,
    maxOutput: 8192,
    supportsTools: false,
    supportsVision: true,
    provider: "anthropic",
  },
];
