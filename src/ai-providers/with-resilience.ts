import { Logger } from '@nestjs/common';
import { AiChatResult, AiProviderError } from './ai-client.interface';

const logger = new Logger('AiResilience');

/**
 * Runs a ladder of AI call attempts — one per budget tier, largest/most-
 * complete first — and adapts to the two provider failure modes that are
 * actually recoverable by retrying:
 *
 *  - `context_too_large`: the request was too big for this provider/model.
 *    Move to the NEXT (smaller) attempt in the ladder instead of failing
 *    outright. This is what fixes "request too large" errors on small-
 *    context free-tier providers (e.g. Groq's free tier) while still
 *    trying the fullest context first on providers that can handle it.
 *  - `rate_limited`: transient. Wait briefly and retry the SAME attempt
 *    once before giving up on it.
 *
 * Every other error kind (invalid key, invalid model, network, etc.) is
 * not retried — retrying an identical request wouldn't help, so failing
 * fast with a clear message is more useful than silently burning attempts.
 *
 * `attempts` are zero-arg closures rather than pre-built requests so each
 * caller can build a smaller context lazily, only when a larger one has
 * already been rejected — a large project is prioritized/truncated once
 * per tier, not eagerly for every tier up front.
 */
export async function callWithResilience(
  attempts: { label: string; run: () => Promise<AiChatResult> }[],
): Promise<{ result: AiChatResult; tierLabel: string }> {
  let lastError: unknown;

  for (let i = 0; i < attempts.length; i++) {
    const { label, run } = attempts[i];
    try {
      const result = await run();
      if (i > 0) logger.log(`Succeeded on reduced-context tier "${label}" after earlier tier(s) were too large`);
      return { result, tierLabel: label };
    } catch (err) {
      if (err instanceof AiProviderError && err.kind === 'rate_limited') {
        logger.warn(`Rate-limited on tier "${label}" — waiting briefly and retrying once`);
        await sleep(2000);
        try {
          const result = await run();
          return { result, tierLabel: label };
        } catch (retryErr) {
          lastError = retryErr;
        }
      } else {
        lastError = err;
      }

      const isTooLarge = lastError instanceof AiProviderError && lastError.kind === 'context_too_large';
      const hasNextTier = i < attempts.length - 1;
      if (isTooLarge && hasNextTier) {
        logger.warn(`Tier "${label}" was too large for the provider — retrying with a smaller context`);
        continue;
      }
      throw lastError;
    }
  }
  throw lastError;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
