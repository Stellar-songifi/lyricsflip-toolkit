import { Injectable, LoggerService as NestLoggerService } from '@nestjs/common';
import { getRequestId } from './request-context';

export type LogFields = Record<string, unknown>;

export interface ErrorLogFields extends LogFields {
  error?: string;
  stack?: string;
}

/**
 * Structured logger wrapper.
 *
 * Every log call accepts an optional fields object that is merged into the
 * log message as a JSON payload, so log management tools (Datadog, CloudWatch)
 * can index and aggregate by `wagerId`, `reason`, `txHash`, etc. The current
 * request ID (from AsyncLocalStorage) is attached automatically when available.
 *
 * Severity convention for settlement code:
 * - `warn`: temporary / retryable issues (pending tx, reconcile retry).
 * - `error`: operator action required (wager moved to `failed`).
 */
@Injectable()
export class LoggerService {
  private readonly logger: NestLoggerService;

  constructor(context: string) {
    this.logger = new NestLoggerService(context);
  }

  private format(message: string, fields?: LogFields): string {
    const requestId = getRequestId();
    const payload: LogFields = { ...(fields ?? {}) };
    if (requestId && payload.requestId === undefined) {
      payload.requestId = requestId;
    }
    if (Object.keys(payload).length === 0) return message;
    return `${message} ${JSON.stringify(payload)}`;
  }

  log(message: string, fields?: LogFields): void {
    this.logger.log(this.format(message, fields));
  }

 warn(message: string, fields?: LogFields): void {
    this.logger.warn(this.format(message, fields));
  }

  error(message: string, fields?: ErrorLogFields): void {
    this.logger.error(this.format(message, fields));
  }

  debug(message: string, fields?: LogFields): void {
    this.logger.debug(this.format(message, fields));
  }

  verbose(message: string, fields?: LogFields): void {
    this.logger.verbose(this.format(message, fields));
  }

  /** Captures an error's message and stack into structured fields. */
  static errorFields(err: unknown, extra: LogFields = {}): ErrorLogFields {
    if (err instanceof Error) {
      return { ...extra, error: err.message, stack: err.stack };
    }
    return { ...extra, error: String(err) };
  }
}
