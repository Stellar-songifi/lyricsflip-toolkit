import { AsyncLocalStorage } from 'node:async_hooks';
import { Global, Injectable, Module, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

@Injectable()
export class RequestContext {
  private readonly storage = new AsyncLocalStorage<string>();

  run<T>(requestId: string | undefined, callback: () => T): T {
    return requestId ? this.storage.run(requestId, callback) : callback();
  }

  get requestId(): string | undefined {
    return this.storage.getStore();
  }
}

@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  constructor(private readonly context: RequestContext) {}

  use(request: Request & { id?: string }, _response: Response, next: NextFunction): void {
    this.context.run(request.id, next);
  }
}

@Global()
@Module({
  providers: [RequestContext, RequestContextMiddleware],
  exports: [RequestContext, RequestContextMiddleware],
})
export class RequestContextModule {}
