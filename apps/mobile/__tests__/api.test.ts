import { ApiError, createApi } from '../src/lib/api';

function fakeFetch(status: number, body: unknown) {
  return jest.fn().mockResolvedValue({ ok: status < 400, status, text: async () => JSON.stringify(body) });
}

describe('api client', () => {
  it('sends the bearer token and JSON body', async () => {
    const fetchImpl = fakeFetch(201, { code: 'ABC123' });
    const api = createApi('http://server', () => 'jwt', fetchImpl as never);
    await api.challenges.create('50000000', 'friend');
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://server/challenges');
    expect(init.headers.authorization).toBe('Bearer jwt');
    expect(JSON.parse(init.body)).toEqual({ stakeAmount: '50000000', opponentUsername: 'friend' });
  });

  it('never sends a user id; the server takes it from the token', async () => {
    const fetchImpl = fakeFetch(201, {});
    const api = createApi('http://server', () => 'jwt', fetchImpl as never);
    await api.game.guess('session-1', 'Thrift Shop');
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({ sessionId: 'session-1', guess: 'Thrift Shop' });
  });

  it('turns error responses into ApiError with the server message', async () => {
    const api = createApi('http://server', () => null, fakeFetch(400, { message: ['stakeAmount must be a number'] }) as never);
    await expect(api.challenges.create('x')).rejects.toEqual(new ApiError(400, 'stakeAmount must be a number'));
  });

  it('omits the signed envelope in mock mode', async () => {
    const fetchImpl = fakeFetch(200, {});
    const api = createApi('http://server', () => 'jwt', fetchImpl as never);
    await api.wagers.stake('w1');
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({});
  });

  it('rejects with ApiError("Request timed out") when request times out', async () => {
    // Hanging fetch that rejects with AbortError when signal fires
    const hangingFetch = jest.fn((_url: string, init: RequestInit) => {
      return new Promise((_resolve, reject) => {
        if (init.signal) {
          init.signal.addEventListener('abort', () => {
            const err = new Error('The operation was aborted');
            err.name = 'AbortError';
            reject(err);
          });
        }
      });
    });

    const api = createApi('http://server', () => 'jwt', hangingFetch as never, 50);
    await expect(api.users.me()).rejects.toEqual(new ApiError(408, 'Request timed out'));
  });

  it('cleans up timeout timer when request completes normally', async () => {
    const clearTimeoutSpy = jest.spyOn(global, 'clearTimeout');
    const fetchImpl = fakeFetch(200, { id: 'u1', username: 'alice' });
    const api = createApi('http://server', () => 'jwt', fetchImpl as never, 5000);

    const res = await api.users.me();
    expect(res).toEqual({ id: 'u1', username: 'alice' });
    expect(clearTimeoutSpy).toHaveBeenCalled();
    clearTimeoutSpy.mockRestore();
  });

  it('enforces the 10s timeout override for faucet endpoints', async () => {
    jest.useFakeTimers();
    try {
      const hangingFetch = jest.fn((_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            const err = new Error('The operation was aborted');
            err.name = 'AbortError';
            reject(err);
          });
        }),
      );

      const api = createApi('http://server', () => 'jwt', hangingFetch as never, 30_000);
      const request = api.faucet.claim();
      const timeoutAssertion = expect(request).rejects.toEqual(new ApiError(408, 'Request timed out'));

      expect(hangingFetch).toHaveBeenCalledWith('http://server/faucet', expect.objectContaining({
        method: 'POST',
        signal: expect.any(Object),
      }));

      await jest.advanceTimersByTimeAsync(9_999);
      expect(jest.getTimerCount()).toBe(1);

      await jest.advanceTimersByTimeAsync(1);
      await timeoutAssertion;
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });
});
