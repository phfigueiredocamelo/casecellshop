import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

export interface ObservabilityContext {
  requestId: string;
  correlationId: string;
  traceId: string;
  spanId?: string;
  parentSpanId?: string;
  orderId?: string;
}

@Injectable()
export class RequestContextService {
  private readonly storage = new AsyncLocalStorage<ObservabilityContext>();

  create(input: Partial<ObservabilityContext> = {}): ObservabilityContext {
    return {
      requestId: input.requestId ?? this.createId('req'),
      correlationId: input.correlationId ?? this.createId('corr'),
      traceId: input.traceId ?? this.createId('trace'),
      spanId: input.spanId,
      parentSpanId: input.parentSpanId,
      orderId: input.orderId
    };
  }

  run<T>(context: ObservabilityContext, callback: () => T): T {
    return this.storage.run(context, callback);
  }

  get(): ObservabilityContext | undefined {
    return this.storage.getStore();
  }

  setOrderId(orderId: string) {
    const context = this.storage.getStore();

    if (context) {
      context.orderId = orderId;
    }
  }

  withContext(extra: Partial<ObservabilityContext>) {
    return {
      ...this.storage.getStore(),
      ...extra
    };
  }

  private createId(prefix: string) {
    return `${prefix}_${randomUUID()}`;
  }
}
