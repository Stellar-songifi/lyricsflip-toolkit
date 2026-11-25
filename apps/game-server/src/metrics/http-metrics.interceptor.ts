import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, finalize } from 'rxjs';
import { MetricsService } from './metrics.service';

interface HttpRequest {
  method?: string;
  baseUrl?: string;
  route?: { path?: string };
}

interface HttpResponse {
  statusCode?: number;
}

@Injectable()
export class HttpMetricsInterceptor implements NestInterceptor {
  constructor(private readonly metrics: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const startedAt = process.hrtime.bigint();
    const http = context.switchToHttp();
    const request = http.getRequest<HttpRequest>();
    const response = http.getResponse<HttpResponse>();
    const method = request.method ?? 'UNKNOWN';
    const route = `${request.baseUrl ?? ''}${request.route?.path ?? 'unmatched'}` || '/';

    return next.handle().pipe(
      finalize(() => {
        const elapsed = Number(process.hrtime.bigint() - startedAt) / 1_000_000_000;
        this.metrics.observeHttpRequest(method, route, response.statusCode ?? 500, elapsed);
      }),
    );
  }
}
