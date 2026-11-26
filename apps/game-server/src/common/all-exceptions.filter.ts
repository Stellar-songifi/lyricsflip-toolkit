import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

interface ErrorResponseBody {
  statusCode: number;
  message: string | string[];
  path: string;
  timestamp: string;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const message = this.resolveMessage(exception, status);

    this.logException(exception, request, status);

    const body: ErrorResponseBody = {
      statusCode: status,
      message,
      path: request?.url ?? '',
      timestamp: new Date().toISOString(),
    };

    response.status(status).json(body);
  }

  private resolveMessage(
    exception: unknown,
    status: number,
  ): string | string[] {
    if (exception instanceof HttpException) {
      const res = exception.getResponse();
      if (typeof res === 'string') {
        return res;
      }
      if (res && typeof res === 'object') {
        const message = (res as { message?: string | string[] }).message;
        if (typeof message === 'string' || Array.isArray(message)) {
          return message;
        }
      }
      return exception.message;
    }

    // Never leak internal details (stack traces, raw driver errors) for 500s.
    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      return 'Internal server error';
    }

    return 'An unexpected error occurred';
  }

  private logException(
    exception: unknown,
    request: Request | undefined,
    status: number,
  ): void {
    const method = request?.method ?? 'UNKNOWN';
    const path = request?.url ?? 'UNKNOWN';
    const user = (request as unknown as { user?: { id?: string | number } })
      ?.user;
    const userContext = user?.id !== undefined ? ` user=${user.id}` : '';

    let name = 'UnknownError';
    let message = 'Unknown error';
    let stack: string | undefined;

    if (exception instanceof Error) {
      name = exception.name;
      message = exception.message;
      stack = exception.stack;
    } else if (typeof exception === 'string') {
      message = exception;
    } else if (exception !== undefined && exception !== null) {
      try {
        message = JSON.stringify(exception);
      } catch {
        message = String(exception);
      }
    }

    const context = `${method} ${path}${userContext} status=${status} error=${name}: ${message}`;

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(context, stack);
    } else {
      this.logger.warn(context);
    }
  }
}