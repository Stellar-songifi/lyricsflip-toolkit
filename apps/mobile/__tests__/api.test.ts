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
});
