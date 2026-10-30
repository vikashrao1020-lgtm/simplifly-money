export class HttpError extends Error {
  readonly status: number;
  readonly retryAfter: string | null;

  constructor(status: number, message: string, retryAfter: string | null) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function getJson<T>(url: string, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<T> {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const timeout = new AbortController();
    const timeoutId = setTimeout(() => timeout.abort(), 20_000);
    const relayAbort = () => timeout.abort();
    signal.addEventListener('abort', relayAbort, { once: true });
    if (signal.aborted) timeout.abort();
    try {
      const response = await fetcher(url, { signal: timeout.signal });
      if (response.ok) return await response.json() as T;
      if (response.status === 410 || (response.status >= 400 && response.status < 500 && response.status !== 429)) {
        throw new HttpError(response.status, `Request failed (${response.status})`, response.headers.get('Retry-After'));
      }
      const retryAfter = response.headers.get('Retry-After');
      if (attempt === 5) throw new HttpError(response.status, `Request failed (${response.status})`, retryAfter);
      await pause(retryAfter ? Math.max(1, Number(retryAfter)) * 1000 : 500 * 2 ** attempt + Math.random() * 180);
    } catch (error) {
      if (signal.aborted) throw error;
      if (error instanceof HttpError) {
        if (error.status === 410 || (error.status >= 400 && error.status < 500 && error.status !== 429) || attempt === 5) throw error;
        const retryAfter = error.retryAfter;
        await pause(retryAfter ? Math.max(1, Number(retryAfter)) * 1000 : 500 * 2 ** attempt + Math.random() * 180);
      } else if (attempt === 5) {
        throw error;
      } else {
        await pause(500 * 2 ** attempt + Math.random() * 180);
      }
    } finally {
      clearTimeout(timeoutId);
      signal.removeEventListener('abort', relayAbort);
    }
  }
  throw new Error('Retry limit reached');
}
