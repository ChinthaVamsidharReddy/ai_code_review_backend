import { AiChatOptions, AiChatResult, AiClient, AiProviderError, ChatMessageInput } from './ai-client.interface';

/**
 * A single client implementation that talks to ANY OpenAI-compatible
 * `/chat/completions` endpoint — this is what lets OpenAI, LM Studio,
 * Ollama's OpenAI-compat mode, OpenRouter, and Groq all be "just a base
 * URL + key + model" instead of needing one class each.
 */
export class OpenAiCompatibleClient implements AiClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string | undefined,
    private readonly model: string,
  ) {}

  async chat(messages: ChatMessageInput[], options: AiChatOptions = {}): Promise<AiChatResult> {
    const { jsonMode = false, temperature = 0.2, maxTokens = 4000, timeoutMs = 60_000 } = options;
    const url = `${this.baseUrl.replace(/\/$/, '')}/chat/completions`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: this.model,
          messages,
          temperature,
          max_tokens: maxTokens,
          ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
        }),
        signal: controller.signal,
      });
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        throw new AiProviderError('The AI provider did not respond in time', 'timeout');
      }
      throw new AiProviderError(`Could not reach AI provider: ${(err as Error).message}`, 'network');
    } finally {
      clearTimeout(timer);
    }

    if (response.status === 401 || response.status === 403) {
      throw new AiProviderError('The AI provider rejected the API key', 'invalid_api_key');
    }
    if (response.status === 429) {
      throw new AiProviderError('The AI provider is rate-limiting requests. Try again shortly.', 'rate_limited');
    }
    if (response.status === 404) {
      throw new AiProviderError(`Model "${this.model}" was not found on this provider`, 'invalid_model');
    }
    if (response.status === 413) {
      throw new AiProviderError('The request was too large for this provider/model', 'context_too_large');
    }

    let json: any;
    try {
      json = await response.json();
    } catch {
      if (!response.ok) {
        throw new AiProviderError(`AI provider returned HTTP ${response.status}`, 'unavailable');
      }
      throw new AiProviderError('AI provider returned a non-JSON response', 'malformed_response');
    }

    if (!response.ok) {
      // Some OpenAI-compatible providers (Groq's API included, depending on
      // model/version) report an oversized request as HTTP 400 with a
      // descriptive error body rather than HTTP 413. Without this check,
      // those get misclassified as a generic "unavailable" error and the
      // resilience ladder never shrinks the context and retries — it just
      // fails immediately on the first, largest attempt.
      const bodyMessage: string = String(json?.error?.message ?? json?.message ?? '').toLowerCase();
      const looksLikeContextOverflow =
        response.status === 400 &&
        /(context.?length|too (many|long)|reduce the length|maximum.*tokens|token limit)/.test(bodyMessage);
      if (looksLikeContextOverflow) {
        throw new AiProviderError(bodyMessage || 'The request was too large for this provider/model', 'context_too_large');
      }
      throw new AiProviderError(`AI provider returned HTTP ${response.status}`, 'unavailable');
    }

    const content: string | undefined = json?.choices?.[0]?.message?.content;
    if (content === undefined || content === null) {
      throw new AiProviderError('AI provider returned an empty response', 'empty_response');
    }
    if (typeof content !== 'string' || content.trim().length === 0) {
      throw new AiProviderError('AI provider returned an empty response', 'empty_response');
    }

    return {
      content,
      model: json?.model ?? this.model,
      usage: json?.usage
        ? { promptTokens: json.usage.prompt_tokens, completionTokens: json.usage.completion_tokens }
        : undefined,
    };
  }
}
