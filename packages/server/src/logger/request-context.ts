import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

export interface RequestContext {
  requestId: string;
}

export const requestContext = new AsyncLocalStorage<RequestContext>();

export function generateRequestId(): string {
  return randomUUID();
}

export function getRequestId(): string | undefined {
  return requestContext.getStore()?.requestId;
}

export function runWithRequestContext<T>(cb: () => T, id: string = generateRequestId()): T {
  return requestContext.run({ requestId: id }, cb);
}
