import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { LoggerService } from './logger.service';
import { RequestContextService } from './request-context.service';

@Injectable()
export class TraceService {
  constructor(
    private readonly requestContext: RequestContextService,
    private readonly logger: LoggerService
  ) {}

  async startSpan<T>(operation: string, callback: () => Promise<T> | T): Promise<T> {
    const parent = this.requestContext.get();
    const spanId = `span_${randomUUID()}`;
    const startedAt = process.hrtime.bigint();

    try {
      const spanContext = {
        requestId: parent?.requestId ?? `req_${randomUUID()}`,
        correlationId: parent?.correlationId ?? `corr_${randomUUID()}`,
        traceId: parent?.traceId ?? `trace_${randomUUID()}`,
        parentSpanId: parent?.spanId,
        spanId,
        orderId: parent?.orderId
      };

      return await this.requestContext.run(spanContext, async () => {
        const result = await callback();
        this.finish(operation, startedAt, 'ok', spanId, parent?.spanId);
        return result;
      });
    } catch (error) {
      this.finish(operation, startedAt, 'error', spanId, parent?.spanId, error);
      throw error;
    }
  }

  private finish(
    operation: string,
    startedAt: bigint,
    status: 'ok' | 'error',
    spanId: string,
    parentSpanId?: string,
    error?: unknown
  ) {
    const context = this.requestContext.get();
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;

    this.logger.info(
      {
        event: 'span.finished',
        service: process.env.SERVICE_NAME ?? 'casecellshop',
        operation,
        status,
        durationMs,
        traceId: context?.traceId,
        spanId,
        parentSpanId,
        correlationId: context?.correlationId,
        requestId: context?.requestId,
        orderId: context?.orderId,
        ...(error instanceof Error
          ? { error: { message: error.message, stack: error.stack, name: error.name } }
          : {})
      },
      'span finished'
    );
  }
}
