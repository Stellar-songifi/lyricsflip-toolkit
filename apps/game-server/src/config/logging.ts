import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { LoggerOptions } from 'pino';
import type { Params } from 'nestjs-pino';

const REQUEST_ID_HEADER = 'x-request-id';

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  const candidate = Array.isArray(value) ? value[0] : value;
  const trimmed = candidate?.trim();
  return trimmed || undefined;
}

/** The shared base guarantees the same field names for Nest, HTTP and domain logs. */
export function structuredLoggerOptions(production: boolean): LoggerOptions {
  return {
    level: process.env.LOG_LEVEL ?? (production ? 'info' : 'debug'),
    messageKey: 'message',
    timestamp: () => `,"timestamp":"${new Date().toISOString()}"`,
    formatters: {
      level: (level) => ({ level }),
    },
    transport: production
      ? undefined
      : {
          target: 'pino-pretty',
          options: {
            colorize: true,
            singleLine: true,
            translateTime: 'SYS:standard',
          },
        },
  };
}

export function requestId(request: IncomingMessage, response: ServerResponse): string {
  const id = firstHeaderValue(request.headers[REQUEST_ID_HEADER]) ?? randomUUID();
  response.setHeader(REQUEST_ID_HEADER, id);
  return id;
}

export function loggingModuleOptions(): Params {
  const production = process.env.NODE_ENV === 'production';

  return {
    pinoHttp: {
      ...structuredLoggerOptions(production),
      genReqId: requestId,
      customProps: (request) => ({
        context: 'HTTP',
        requestId: request.id,
      }),
      serializers: {
        req: (request) => ({ method: request.method, url: request.url }),
        res: (response) => ({ statusCode: response.statusCode }),
      },
    },
  };
}
