export interface ChatMessageInput {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AiChatOptions {
  /** When set, the client asks the provider for JSON output where
   *  supported, and the caller is expected to JSON.parse() the result. */
  jsonMode?: boolean;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
}

export interface AiChatResult {
  content: string;
  model: string;
  usage?: { promptTokens?: number; completionTokens?: number };
}

/** A well-known, provider-neutral error so callers (reviews, chat) can
 *  return useful messages instead of a raw 500. */
export class AiProviderError extends Error {
  constructor(
    message: string,
    public readonly kind:
      | 'timeout'
      | 'rate_limited'
      | 'invalid_api_key'
      | 'unavailable'
      | 'invalid_model'
      | 'empty_response'
      | 'malformed_response'
      | 'network'
      | 'context_too_large'
      | 'unknown',
  ) {
    super(message);
    this.name = 'AiProviderError';
  }
}

/** The provider-agnostic contract every AI backend (OpenAI, LM Studio,
 *  Ollama, OpenRouter, or any other OpenAI-compatible endpoint) implements.
 *  Review engine and chat code against this interface only — adding a new
 *  provider never requires touching them. */
export interface AiClient {
  chat(messages: ChatMessageInput[], options?: AiChatOptions): Promise<AiChatResult>;
}
