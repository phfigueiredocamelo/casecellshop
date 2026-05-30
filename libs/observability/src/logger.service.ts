import { Injectable } from '@nestjs/common';
import pino, { Logger } from 'pino';
import { env } from '../../config/src/env';
import { RequestContextService } from './request-context.service';

@Injectable()
export class LoggerService {
  private readonly logger: Logger = pino({
    level: env.logLevel,
    base: undefined,
    timestamp: pino.stdTimeFunctions.isoTime
  });

  constructor(private readonly requestContext: RequestContextService) {}

  info(payload: Record<string, unknown>, message: string) {
    this.logger.info(this.withContext(payload), message);
  }

  warn(payload: Record<string, unknown>, message: string) {
    this.logger.warn(this.withContext(payload), message);
  }

  error(payload: Record<string, unknown>, message: string) {
    this.logger.error(this.withContext(payload), message);
  }

  child(bindings: Record<string, unknown>) {
    return this.logger.child(bindings);
  }

  withContext(payload: Record<string, unknown>) {
    const context = this.requestContext.get();

    if (!context) {
      return payload;
    }

    return {
      ...payload,
      requestId: context.requestId,
      correlationId: context.correlationId,
      traceId: context.traceId,
      ...(context.orderId ? { orderId: context.orderId } : {})
    };
  }
}
