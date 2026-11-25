import { Writable } from 'node:stream';
import pino from 'pino';
import { requestId, structuredLoggerOptions } from './logging';

describe('structured logging', () => {
  it('emits the production fields as valid JSON', () => {
    const output: string[] = [];
    const destination = new Writable({
      write(chunk, _encoding, callback) {
        output.push(chunk.toString());
        callback();
      },
    });
    const logger = pino(structuredLoggerOptions(true), destination).child({
      context: 'LoggingSpec',
      requestId: 'request-123',
    });

    logger.info('structured message');

    expect(output).toHaveLength(1);
    const line = JSON.parse(output[0]) as Record<string, unknown>;
    expect(line).toMatchObject({
      level: 'info',
      message: 'structured message',
      context: 'LoggingSpec',
      requestId: 'request-123',
    });
    expect(new Date(line.timestamp as string).toISOString()).toBe(line.timestamp);
  });

  it('propagates an incoming request id and returns it to the client', () => {
    const setHeader = jest.fn();
    const id = requestId(
      { headers: { 'x-request-id': ' upstream-request ' } } as never,
      { setHeader } as never,
    );

    expect(id).toBe('upstream-request');
    expect(setHeader).toHaveBeenCalledWith('x-request-id', 'upstream-request');
  });

  it('generates a request id when the incoming header is absent', () => {
    const setHeader = jest.fn();
    const id = requestId({ headers: {} } as never, { setHeader } as never);

    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(setHeader).toHaveBeenCalledWith('x-request-id', id);
  });
});
