import { AiProviderError } from '../ai-client.interface';
import { callWithResilience } from '../with-resilience';

describe('callWithResilience', () => {
  it('returns the first tier\'s result when it succeeds', async () => {
    const run = jest.fn().mockResolvedValue({ content: 'ok', model: 'test-model' });
    const { result, tierLabel } = await callWithResilience([{ label: 'standard', run }]);
    expect(result.content).toBe('ok');
    expect(tierLabel).toBe('standard');
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('falls back to a smaller tier when the provider reports the context as too large', async () => {
    const bigRun = jest.fn().mockRejectedValue(new AiProviderError('too big', 'context_too_large'));
    const smallRun = jest.fn().mockResolvedValue({ content: 'fits now', model: 'test-model' });

    const { result, tierLabel } = await callWithResilience([
      { label: 'standard', run: bigRun },
      { label: 'minimal', run: smallRun },
    ]);

    expect(result.content).toBe('fits now');
    expect(tierLabel).toBe('minimal');
    expect(bigRun).toHaveBeenCalledTimes(1);
    expect(smallRun).toHaveBeenCalledTimes(1);
  });

  it('throws immediately on a non-recoverable error without trying smaller tiers', async () => {
    const invalidKeyRun = jest.fn().mockRejectedValue(new AiProviderError('bad key', 'invalid_api_key'));
    const neverCalled = jest.fn().mockResolvedValue({ content: 'should not run', model: 'test-model' });

    await expect(
      callWithResilience([
        { label: 'standard', run: invalidKeyRun },
        { label: 'minimal', run: neverCalled },
      ]),
    ).rejects.toMatchObject({ kind: 'invalid_api_key' });
    expect(neverCalled).not.toHaveBeenCalled();
  });

  it('throws the final tier\'s error when every tier is too large', async () => {
    const alwaysTooLarge = () => Promise.reject(new AiProviderError('still too big', 'context_too_large'));
    await expect(
      callWithResilience([
        { label: 'standard', run: alwaysTooLarge },
        { label: 'minimal', run: alwaysTooLarge },
      ]),
    ).rejects.toMatchObject({ kind: 'context_too_large' });
  });

  it('retries once on rate limiting and succeeds on the retry', async () => {
    const rateLimitedThenOk = jest
      .fn()
      .mockRejectedValueOnce(new AiProviderError('slow down', 'rate_limited'))
      .mockResolvedValueOnce({ content: 'ok after retry', model: 'test-model' });

    const { result } = await callWithResilience([{ label: 'standard', run: rateLimitedThenOk }]);
    expect(result.content).toBe('ok after retry');
    expect(rateLimitedThenOk).toHaveBeenCalledTimes(2);
  }, 10_000);
});
