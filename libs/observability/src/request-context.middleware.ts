import { Injectable, NestMiddleware } from '@nestjs/common';
import { RequestContextService } from './request-context.service';

interface MiddlewareRequest {
  header(name: string): string | undefined;
}

interface MiddlewareResponse {
  setHeader(name: string, value: string): void;
}

type NextFunction = () => void;

@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  constructor(private readonly requestContext: RequestContextService) {}

  use(req: MiddlewareRequest, res: MiddlewareResponse, next: NextFunction) {
    const context = this.requestContext.create({
      correlationId: req.header('x-correlation-id') ?? undefined
    });

    res.setHeader('X-Request-Id', context.requestId);
    res.setHeader('X-Correlation-Id', context.correlationId);

    this.requestContext.run(context, () => next());
  }
}
