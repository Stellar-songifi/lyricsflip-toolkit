import { RequestContext } from './request-context';

describe('RequestContext', () => {
  it('keeps the request id across asynchronous work and isolates it afterwards', async () => {
    const context = new RequestContext();

    await context.run('request-123', async () => {
      await Promise.resolve();
      expect(context.requestId).toBe('request-123');
    });

    expect(context.requestId).toBeUndefined();
  });
});
