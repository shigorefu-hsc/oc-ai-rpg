/** Retry only Lambda admission throttles, where application code never started.
 * Application 429s (budget/call limits) and uncertain network failures are never replayed. */
export async function fetchWithCapacityRetry(
  input: RequestInfo | URL,
  init: RequestInit,
  fetcher = fetch,
  wait = delay,
): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const response = await fetcher(input, init);
    if (response.status !== 429 || attempt >= 7) return response;
    const data = await response
      .clone()
      .json()
      .catch(() => null);
    if (data?.error) return response;
    await response.body?.cancel();
    await wait(Math.min(6000, 800 * 2 ** attempt) + Math.random() * 1000, init.signal ?? undefined);
  }
}
function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const end = () => {
      signal?.removeEventListener('abort', abort);
      resolve();
    };
    const timer = setTimeout(end, ms);
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      reject(signal?.reason);
    };
    signal?.addEventListener('abort', abort, { once: true });
  });
}
