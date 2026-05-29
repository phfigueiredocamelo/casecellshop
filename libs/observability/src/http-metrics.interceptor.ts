import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor
} from '@nestjs/common';
import { Observable, catchError, tap, throwError } from 'rxjs';
import { MetricsService } from './metrics.service';

interface HttpRequest {
  method?: string;
  originalUrl?: string;
  route?: {
    path?: string;
  };
}

interface HttpResponse {
  statusCode?: number;
}

interface HttpError {
  getStatus?: () => number;
  status?: number;
}

@Injectable()
export class HttpMetricsInterceptor implements NestInterceptor {
  constructor(private readonly metricsService: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const startedAt = process.hrtime.bigint();
    const http = context.switchToHttp();
    const request = http.getRequest<HttpRequest>();
    const response = http.getResponse<HttpResponse>();
    const method = request.method ?? 'UNKNOWN';
    const route = request.route?.path ?? request.originalUrl?.split('?')[0] ?? 'unknown';

    return next.handle().pipe(
      tap(() => {
        this.observe(route, method, response.statusCode ?? 200, startedAt);
      }),
      catchError((error: HttpError) => {
        this.observe(route, method, error.getStatus?.() ?? error.status ?? 500, startedAt);

        return throwError(() => error);
      })
    );
  }

  private observe(route: string, method: string, status: number, startedAt: bigint) {
    const durationSeconds = Number(process.hrtime.bigint() - startedAt) / 1_000_000_000;

    this.metricsService.recordHttpRequest({
      route,
      method,
      status,
      durationSeconds
    });
  }
}
