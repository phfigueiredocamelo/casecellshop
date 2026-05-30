# Contract and Observability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add mandatory OpenAPI contract coverage, structured correlation-aware logs, Prometheus metrics for cache/checkout/queue/workers/ERP, tracing stub spans, and README operational docs.

**Architecture:** Keep the current NestJS monorepo shape. Add focused observability primitives in `libs/observability`, wire them globally into the API and workers, then instrument the product cache path, checkout path, outbox publisher, RabbitMQ service, order worker, ERP clients, and reconciliation path. Use a lightweight trace stub that emits span logs instead of adding an external collector.

**Tech Stack:** NestJS 11, TypeScript, Prisma, Redis via ioredis, RabbitMQ via amqplib, Pino, prom-client, Jest integration tests, `@nestjs/swagger` for OpenAPI.

---

## File Structure

- Create `libs/observability/src/request-context.service.ts`: AsyncLocalStorage-backed context for `requestId`, `correlationId`, `traceId`, `spanId`, and optional `orderId`.
- Create `libs/observability/src/request-context.middleware.ts`: HTTP middleware that reads `X-Correlation-Id`, creates `X-Request-Id`, and returns both headers.
- Create `libs/observability/src/http-error.filter.ts`: standard JSON error envelope with `requestId`, `correlationId`, and optional `orderId`.
- Create `libs/observability/src/trace.service.ts`: trace/span stub that emits structured `span.finished` logs.
- Modify `libs/observability/src/logger.service.ts`: add context-aware `withContext` behavior while preserving existing `info`, `warn`, `error`, and `child`.
- Modify `libs/observability/src/metrics.service.ts`: add mandatory counters, gauges, and histograms.
- Modify `libs/observability/src/http-metrics.interceptor.ts`: tag route/method/status and keep request context.
- Modify `libs/observability/src/observability.module.ts`: export context, trace, metrics, logger, middleware, and error filter.
- Modify `libs/observability/src/index.ts`: export new observability primitives.
- Modify `libs/cache/src/cache.service.ts`: record Redis operation duration and trace cache spans.
- Modify `libs/queue/src/rabbit.service.ts`: propagate headers and record queue metrics/spans.
- Modify `apps/api/src/main.ts`: configure Swagger document, `/docs`, and `/openapi.json`.
- Modify `apps/api/src/app.module.ts`: apply request context middleware.
- Create `apps/api/src/common/api-error.dto.ts`: Swagger error DTO.
- Create DTO files under `apps/api/src/products/dto`, `apps/api/src/checkout/dto`, `apps/api/src/orders/dto`, and `apps/api/src/admin/dto`.
- Modify API controllers to annotate OpenAPI success/error schemas and headers.
- Create `tests/helpers/create-api-test-app.ts`: shared Nest test app bootstrap for Supertest-based API contract and observability tests.
- Modify `apps/api/src/products/products.service.ts`: log/metric/trace cache hit, miss, hydration, and repo fetch.
- Modify `apps/api/src/checkout/checkout.service.ts`: log/metric/trace checkout start/end/rejections and attach `orderId`.
- Modify `apps/outbox-worker/src/outbox.publisher.ts`: propagate correlation and trace context to RabbitMQ headers and record metrics/logs.
- Modify `apps/order-worker/src/billing.consumer.ts`: restore context from message, record worker/ERP metrics, logs, and spans.
- Modify `apps/order-worker/src/erp.client.ts` and `apps/reconciliation-worker/src/erp-catalog.client.ts`: trace fake ERP calls and record ERP metrics.
- Modify `apps/reconciliation-worker/src/reconciliation.runner.ts`: record reconciliation divergences.
- Modify `README.md`: add OpenAPI location, dashboard, alerts, runbooks, decisions, limitations, and AI prompts.
- Modify tests in `tests/integration` and `tests/helpers` to assert contract, context, metrics, traces, and worker propagation.

---

### Task 1: Add Observability Context and Standard Error Envelope

**Files:**
- Create: `libs/observability/src/request-context.service.ts`
- Create: `libs/observability/src/request-context.middleware.ts`
- Create: `libs/observability/src/http-error.filter.ts`
- Modify: `libs/observability/src/logger.service.ts`
- Modify: `libs/observability/src/observability.module.ts`
- Modify: `libs/observability/src/index.ts`
- Modify: `apps/api/src/app.module.ts`
- Create: `tests/helpers/create-api-test-app.ts`
- Test: `tests/integration/observability-context.int-spec.ts`

- [ ] **Step 1: Write failing tests for response headers and error envelope**

```ts
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createApiTestApp } from '../helpers/create-api-test-app';

describe('observability context', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createApiTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns request and correlation headers on successful requests', async () => {
    const response = await request(app.getHttpServer())
      .get('/health')
      .set('X-Correlation-Id', 'corr-test-1')
      .expect(200);

    expect(response.headers['x-correlation-id']).toBe('corr-test-1');
    expect(response.headers['x-request-id']).toMatch(/^req_/);
  });

  it('includes requestId and correlationId in standard error responses', async () => {
    const response = await request(app.getHttpServer())
      .post('/checkout')
      .set('X-Correlation-Id', 'corr-checkout-error')
      .send({ items: [] })
      .expect(400);

    expect(response.body).toMatchObject({
      statusCode: 400,
      error: 'Bad Request',
      correlationId: 'corr-checkout-error'
    });
    expect(response.body.requestId).toMatch(/^req_/);
    expect(response.headers['x-correlation-id']).toBe('corr-checkout-error');
    expect(response.headers['x-request-id']).toBe(response.body.requestId);
  });
});
```

- [ ] **Step 2: Run the new test and verify it fails**

Run: `npm test -- --runTestsByPath tests/integration/observability-context.int-spec.ts`

Expected: FAIL because `createApiTestApp` has no context middleware/filter yet and headers/body fields are missing.

- [ ] **Step 3: Implement request context service**

```ts
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
```

- [ ] **Step 4: Implement request context middleware**

```ts
import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { RequestContextService } from './request-context.service';

@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  constructor(private readonly requestContext: RequestContextService) {}

  use(req: Request, res: Response, next: NextFunction) {
    const correlationHeader = req.header('x-correlation-id');
    const context = this.requestContext.create({
      correlationId: correlationHeader || undefined
    });

    res.setHeader('X-Request-Id', context.requestId);
    res.setHeader('X-Correlation-Id', context.correlationId);

    this.requestContext.run(context, next);
  }
}
```

- [ ] **Step 5: Implement standard HTTP error filter**

```ts
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Injectable
} from '@nestjs/common';
import { Request, Response } from 'express';
import { RequestContextService } from './request-context.service';

@Catch()
@Injectable()
export class HttpErrorFilter implements ExceptionFilter {
  constructor(private readonly requestContext: RequestContextService) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const http = host.switchToHttp();
    const response = http.getResponse<Response>();
    const request = http.getRequest<Request>();
    const context = this.requestContext.get();
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;
    const exceptionResponse =
      exception instanceof HttpException ? exception.getResponse() : undefined;
    const message =
      typeof exceptionResponse === 'object' &&
      exceptionResponse !== null &&
      'message' in exceptionResponse
        ? (exceptionResponse as { message: string | string[] }).message
        : exception instanceof Error
          ? exception.message
          : 'Internal server error';
    const error =
      typeof exceptionResponse === 'object' &&
      exceptionResponse !== null &&
      'error' in exceptionResponse
        ? String((exceptionResponse as { error: string }).error)
        : HttpStatus[status] ?? 'Error';

    response.status(status).json({
      statusCode: status,
      error,
      message,
      requestId: context?.requestId,
      correlationId: context?.correlationId,
      ...(context?.orderId ? { orderId: context.orderId } : {}),
      path: request.url
    });
  }
}
```

- [ ] **Step 6: Wire middleware and filter globally**

Modify `libs/observability/src/observability.module.ts`:

```ts
import { Global, Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { HttpErrorFilter } from './http-error.filter';
import { HttpMetricsInterceptor } from './http-metrics.interceptor';
import { LoggerModule } from './logger.module';
import { MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';
import { RequestContextMiddleware } from './request-context.middleware';
import { RequestContextService } from './request-context.service';

@Global()
@Module({
  imports: [LoggerModule],
  controllers: [MetricsController],
  providers: [
    MetricsService,
    RequestContextService,
    RequestContextMiddleware,
    HttpMetricsInterceptor,
    {
      provide: APP_INTERCEPTOR,
      useExisting: HttpMetricsInterceptor
    },
    {
      provide: APP_FILTER,
      useClass: HttpErrorFilter
    }
  ],
  exports: [LoggerModule, MetricsService, RequestContextService, RequestContextMiddleware]
})
export class ObservabilityModule {}
```

Modify `apps/api/src/app.module.ts`:

```ts
import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { CacheModule } from '../../../libs/cache/src';
import { PrismaModule } from '../../../libs/db/src';
import { ObservabilityModule, RequestContextMiddleware } from '../../../libs/observability/src';
import { ErpCatalogClient } from '../../reconciliation-worker/src/erp-catalog.client';
import { ReconciliationRunner } from '../../reconciliation-worker/src/reconciliation.runner';
import { AdminController } from './admin/admin.controller';
import { CheckoutController } from './checkout/checkout.controller';
import { CheckoutService } from './checkout/checkout.service';
import { HealthController } from './health.controller';
import { OrdersController } from './orders/orders.controller';
import { ProductsController } from './products/products.controller';
import { ProductsService } from './products/products.service';

@Module({
  imports: [ObservabilityModule, PrismaModule, CacheModule],
  controllers: [
    HealthController,
    ProductsController,
    CheckoutController,
    OrdersController,
    AdminController
  ],
  providers: [ProductsService, CheckoutService, ErpCatalogClient, ReconciliationRunner]
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestContextMiddleware).forRoutes('*');
  }
}
```

Modify `libs/observability/src/index.ts`:

```ts
export * from './http-error.filter';
export * from './http-metrics.interceptor';
export * from './logger.module';
export * from './logger.service';
export * from './metrics.controller';
export * from './metrics.service';
export * from './observability.module';
export * from './request-context.middleware';
export * from './request-context.service';
```

- [ ] **Step 7: Add shared API test app helper**

Create `tests/helpers/create-api-test-app.ts`:

```ts
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../apps/api/src/app.module';

export async function createApiTestApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule]
  }).compile();
  const app = moduleRef.createNestApplication({ logger: false });

  await app.init();

  return app;
}
```

- [ ] **Step 8: Run test and commit**

Run: `npm test -- --runTestsByPath tests/integration/observability-context.int-spec.ts`

Expected: PASS.

```bash
git add libs/observability/src apps/api/src/app.module.ts tests/helpers/create-api-test-app.ts tests/integration/observability-context.int-spec.ts
git commit -m "feat: add request correlation context"
```

---

### Task 2: Add Mandatory Metrics

**Files:**
- Modify: `libs/observability/src/metrics.service.ts`
- Test: `tests/integration/observability-metrics.int-spec.ts`

- [ ] **Step 1: Write failing metrics registration test**

```ts
import { MetricsService } from '../../libs/observability/src';

describe('mandatory observability metrics', () => {
  it('registers checkout, queue, worker, ERP, Redis, and reconciliation metrics', async () => {
    const metrics = new MetricsService();

    metrics.recordRedisOperation({ operation: 'get', outcome: 'hit', durationSeconds: 0.01 });
    metrics.recordCheckoutStarted();
    metrics.recordCheckoutAccepted();
    metrics.recordCheckoutRejectedOutOfStock();
    metrics.recordCheckoutDuration({ outcome: 'accepted', durationSeconds: 0.05 });
    metrics.recordIdempotencyDuplicate();
    metrics.setOutboxPending(3);
    metrics.recordOutboxPublished();
    metrics.recordOutboxPublishFailed();
    metrics.setRabbitQueueMessages('orders.billing.q', 2);
    metrics.setRabbitDlqMessages('orders.billing.dlq', 1);
    metrics.recordWorkerProcessing({ worker: 'order-worker', outcome: 'success', durationSeconds: 0.2 });
    metrics.recordWorkerRetry('order-worker');
    metrics.recordErpRequest({ operation: 'billing', outcome: 'error', durationSeconds: 0.3 });
    metrics.recordErpError('billing');
    metrics.recordReconciliationDivergence();

    const output = await metrics.getMetrics();

    expect(output).toContain('redis_operation_duration_seconds');
    expect(output).toContain('checkout_started_total');
    expect(output).toContain('orders_accepted_total');
    expect(output).toContain('orders_rejected_out_of_stock_total');
    expect(output).toContain('checkout_processing_duration_seconds');
    expect(output).toContain('idempotency_duplicate_total');
    expect(output).toContain('outbox_pending_total');
    expect(output).toContain('outbox_published_total');
    expect(output).toContain('outbox_publish_failed_total');
    expect(output).toContain('rabbitmq_queue_messages');
    expect(output).toContain('rabbitmq_dlq_messages');
    expect(output).toContain('worker_processing_duration_seconds');
    expect(output).toContain('worker_retries_total');
    expect(output).toContain('erp_request_duration_seconds');
    expect(output).toContain('erp_errors_total');
    expect(output).toContain('reconciliation_divergences_total');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --runTestsByPath tests/integration/observability-metrics.int-spec.ts`

Expected: FAIL with missing methods on `MetricsService`.

- [ ] **Step 3: Extend metrics service**

Add these metric fields and methods to `libs/observability/src/metrics.service.ts`:

```ts
readonly redisOperationDurationSeconds = new Histogram({
  name: 'redis_operation_duration_seconds',
  help: 'Redis operation latency in seconds',
  labelNames: ['operation', 'outcome'],
  registers: [this.registry]
});
readonly checkoutStartedTotal = new Counter({
  name: 'checkout_started_total',
  help: 'Checkout attempts started',
  registers: [this.registry]
});
readonly ordersAcceptedTotal = new Counter({
  name: 'orders_accepted_total',
  help: 'Orders accepted by checkout',
  registers: [this.registry]
});
readonly ordersRejectedOutOfStockTotal = new Counter({
  name: 'orders_rejected_out_of_stock_total',
  help: 'Checkout attempts rejected because stock is unavailable',
  registers: [this.registry]
});
readonly checkoutProcessingDurationSeconds = new Histogram({
  name: 'checkout_processing_duration_seconds',
  help: 'Checkout processing latency in seconds',
  labelNames: ['outcome'],
  registers: [this.registry]
});
readonly idempotencyDuplicateTotal = new Counter({
  name: 'idempotency_duplicate_total',
  help: 'Idempotent checkout replays',
  registers: [this.registry]
});
readonly outboxPendingTotal = new Gauge({
  name: 'outbox_pending_total',
  help: 'Pending outbox events waiting to publish',
  registers: [this.registry]
});
readonly outboxPublishedTotal = new Counter({
  name: 'outbox_published_total',
  help: 'Outbox events published to RabbitMQ',
  registers: [this.registry]
});
readonly outboxPublishFailedTotal = new Counter({
  name: 'outbox_publish_failed_total',
  help: 'Outbox publish failures',
  registers: [this.registry]
});
readonly rabbitmqQueueMessages = new Gauge({
  name: 'rabbitmq_queue_messages',
  help: 'RabbitMQ main queue message count',
  labelNames: ['queue'],
  registers: [this.registry]
});
readonly rabbitmqDlqMessages = new Gauge({
  name: 'rabbitmq_dlq_messages',
  help: 'RabbitMQ dead-letter queue message count',
  labelNames: ['queue'],
  registers: [this.registry]
});
readonly workerProcessingDurationSeconds = new Histogram({
  name: 'worker_processing_duration_seconds',
  help: 'Worker message processing latency in seconds',
  labelNames: ['worker', 'outcome'],
  registers: [this.registry]
});
readonly workerRetriesTotal = new Counter({
  name: 'worker_retries_total',
  help: 'Worker retry attempts',
  labelNames: ['worker'],
  registers: [this.registry]
});
readonly erpRequestDurationSeconds = new Histogram({
  name: 'erp_request_duration_seconds',
  help: 'Fake ERP request latency in seconds',
  labelNames: ['operation', 'outcome'],
  registers: [this.registry]
});
readonly erpErrorsTotal = new Counter({
  name: 'erp_errors_total',
  help: 'Fake ERP request failures',
  labelNames: ['operation'],
  registers: [this.registry]
});
readonly reconciliationDivergencesTotal = new Counter({
  name: 'reconciliation_divergences_total',
  help: 'Reconciliation divergences detected',
  registers: [this.registry]
});

recordRedisOperation(input: { operation: string; outcome: string; durationSeconds: number }) {
  this.redisOperationDurationSeconds.labels(input.operation, input.outcome).observe(input.durationSeconds);
}

recordCheckoutStarted() {
  this.checkoutStartedTotal.inc();
}

recordCheckoutAccepted() {
  this.ordersAcceptedTotal.inc();
}

recordCheckoutRejectedOutOfStock() {
  this.ordersRejectedOutOfStockTotal.inc();
}

recordCheckoutDuration(input: { outcome: string; durationSeconds: number }) {
  this.checkoutProcessingDurationSeconds.labels(input.outcome).observe(input.durationSeconds);
}

recordIdempotencyDuplicate() {
  this.idempotencyDuplicateTotal.inc();
}

setOutboxPending(count: number) {
  this.outboxPendingTotal.set(count);
}

recordOutboxPublished() {
  this.outboxPublishedTotal.inc();
}

recordOutboxPublishFailed() {
  this.outboxPublishFailedTotal.inc();
}

setRabbitQueueMessages(queue: string, count: number) {
  this.rabbitmqQueueMessages.labels(queue).set(count);
}

setRabbitDlqMessages(queue: string, count: number) {
  this.rabbitmqDlqMessages.labels(queue).set(count);
}

recordWorkerProcessing(input: { worker: string; outcome: string; durationSeconds: number }) {
  this.workerProcessingDurationSeconds.labels(input.worker, input.outcome).observe(input.durationSeconds);
}

recordWorkerRetry(worker: string) {
  this.workerRetriesTotal.labels(worker).inc();
}

recordErpRequest(input: { operation: string; outcome: string; durationSeconds: number }) {
  this.erpRequestDurationSeconds.labels(input.operation, input.outcome).observe(input.durationSeconds);
}

recordErpError(operation: string) {
  this.erpErrorsTotal.labels(operation).inc();
}

recordReconciliationDivergence(count = 1) {
  this.reconciliationDivergencesTotal.inc(count);
}
```

Also import `Gauge`:

```ts
import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';
```

- [ ] **Step 4: Run test and commit**

Run: `npm test -- --runTestsByPath tests/integration/observability-metrics.int-spec.ts`

Expected: PASS.

```bash
git add libs/observability/src/metrics.service.ts tests/integration/observability-metrics.int-spec.ts
git commit -m "feat: add required operational metrics"
```

---

### Task 3: Add TraceService Stub

**Files:**
- Create: `libs/observability/src/trace.service.ts`
- Modify: `libs/observability/src/observability.module.ts`
- Modify: `libs/observability/src/index.ts`
- Test: `tests/integration/trace-service.int-spec.ts`

- [ ] **Step 1: Write failing TraceService test**

```ts
import { LoggerService, RequestContextService, TraceService } from '../../libs/observability/src';

describe('TraceService', () => {
  it('emits span.finished logs with trace and correlation fields', async () => {
    const context = new RequestContextService();
    const logger = new LoggerService();
    const infoSpy = jest.spyOn(logger, 'info').mockImplementation(() => undefined);
    const trace = new TraceService(context, logger);
    const base = context.create({
      requestId: 'req-test',
      correlationId: 'corr-test',
      traceId: 'trace-test'
    });

    await context.run(base, () =>
      trace.startSpan('cache.get', async () => {
        return 'ok';
      })
    );

    expect(infoSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'span.finished',
        operation: 'cache.get',
        traceId: 'trace-test',
        correlationId: 'corr-test',
        requestId: 'req-test',
        status: 'ok'
      }),
      'span finished'
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --runTestsByPath tests/integration/trace-service.int-spec.ts`

Expected: FAIL because `TraceService` does not exist.

- [ ] **Step 3: Implement TraceService**

```ts
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
```

- [ ] **Step 4: Export and provide TraceService**

Add `TraceService` to `ObservabilityModule.providers` and `exports`, and export it from `libs/observability/src/index.ts`:

```ts
export * from './trace.service';
```

- [ ] **Step 5: Run test and commit**

Run: `npm test -- --runTestsByPath tests/integration/trace-service.int-spec.ts`

Expected: PASS.

```bash
git add libs/observability/src tests/integration/trace-service.int-spec.ts
git commit -m "feat: add trace span stub"
```

---

### Task 4: Add OpenAPI Contract

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `apps/api/src/main.ts`
- Create: `apps/api/src/common/api-error.dto.ts`
- Create: `apps/api/src/products/dto/product-response.dto.ts`
- Create: `apps/api/src/products/dto/product-list-response.dto.ts`
- Create: `apps/api/src/checkout/dto/checkout.dto.ts`
- Create: `apps/api/src/orders/dto/order-response.dto.ts`
- Create: `apps/api/src/admin/dto/admin-response.dto.ts`
- Modify: API controllers in `apps/api/src`
- Test: `tests/integration/openapi.int-spec.ts`

- [ ] **Step 1: Install Swagger dependency**

Run: `npm install @nestjs/swagger swagger-ui-express`

Expected: `package.json` and `package-lock.json` include `@nestjs/swagger` and `swagger-ui-express`.

- [ ] **Step 2: Write failing OpenAPI test**

```ts
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createApiTestApp } from '../helpers/create-api-test-app';

describe('OpenAPI contract', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createApiTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('exposes /openapi.json with success and error schemas', async () => {
    const response = await request(app.getHttpServer()).get('/openapi.json').expect(200);

    expect(response.body.paths['/checkout'].post.responses['202']).toBeDefined();
    expect(response.body.paths['/checkout'].post.responses['400']).toBeDefined();
    expect(response.body.paths['/checkout'].post.responses['409']).toBeDefined();
    expect(response.body.paths['/checkout'].post.responses['422']).toBeDefined();
    expect(response.body.components.schemas.ApiErrorDto.properties).toMatchObject({
      statusCode: expect.any(Object),
      error: expect.any(Object),
      message: expect.any(Object),
      requestId: expect.any(Object),
      correlationId: expect.any(Object),
      orderId: expect.any(Object)
    });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- --runTestsByPath tests/integration/openapi.int-spec.ts`

Expected: FAIL because `/openapi.json` is not registered.

- [ ] **Step 4: Add Swagger setup helper in `apps/api/src/main.ts`**

```ts
import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

export function configureOpenApi(app: INestApplication) {
  const config = new DocumentBuilder()
    .setTitle('CaseCellShop API')
    .setDescription('Backend demo API for catalog, checkout, orders, and reconciliation')
    .setVersion('1.0.0')
    .addApiKey({ type: 'apiKey', name: 'X-Customer-Id', in: 'header' }, 'customer-id')
    .addApiKey({ type: 'apiKey', name: 'Idempotency-Key', in: 'header' }, 'idempotency-key')
    .addApiKey({ type: 'apiKey', name: 'X-Correlation-Id', in: 'header' }, 'correlation-id')
    .build();
  const document = SwaggerModule.createDocument(app, config);

  SwaggerModule.setup('docs', app, document);
  const httpAdapter = app.getHttpAdapter();
  httpAdapter.get('/openapi.json', (_req: unknown, res: { json: (body: unknown) => void }) => {
    res.json(document);
  });

  return document;
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  configureOpenApi(app);
  await app.listen(Number(process.env.API_PORT ?? 3000));
}

void bootstrap();
```

Update `tests/helpers/create-api-test-app.ts` so `createApiTestApp()` calls `configureOpenApi(app)` before `app.init()`:

```ts
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../apps/api/src/app.module';
import { configureOpenApi } from '../../apps/api/src/main';

export async function createApiTestApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule]
  }).compile();
  const app = moduleRef.createNestApplication({ logger: false });

  configureOpenApi(app);
  await app.init();

  return app;
}
```

- [ ] **Step 5: Add DTOs and controller decorators**

Create `apps/api/src/common/api-error.dto.ts`:

```ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ApiErrorDto {
  @ApiProperty({ example: 409 })
  statusCode!: number;

  @ApiProperty({ example: 'Conflict' })
  error!: string;

  @ApiProperty({ example: 'Idempotency key reused with different payload' })
  message!: string | string[];

  @ApiProperty({ example: 'req_01HX...' })
  requestId!: string;

  @ApiProperty({ example: 'corr_01HX...' })
  correlationId!: string;

  @ApiPropertyOptional({ example: 'ord_01HX...' })
  orderId?: string;

  @ApiPropertyOptional({ example: '/checkout' })
  path?: string;
}
```

Create DTO classes for current response shapes. Use `ApiProperty` on every field and keep DTO property names identical to runtime JSON:

```ts
export class CheckoutItemDto {
  @ApiProperty({ example: 'prod_case_iphone_15_clear' })
  productId!: string;

  @ApiProperty({ example: 2, minimum: 1 })
  quantity!: number;
}

export class CheckoutRequestDto {
  @ApiProperty({ type: [CheckoutItemDto] })
  items!: CheckoutItemDto[];
}

export class CheckoutAcceptedResponseDto {
  @ApiProperty()
  orderId!: string;

  @ApiProperty({ example: 'PENDING_ERP' })
  status!: string;

  @ApiProperty({ example: 5990 })
  totalCents!: number;

  @ApiProperty({ example: 'BRL' })
  currency!: string;
}
```

Annotate `CheckoutController`:

```ts
@ApiTags('checkout')
@ApiHeader({ name: 'X-Customer-Id', required: true })
@ApiHeader({ name: 'Idempotency-Key', required: true })
@ApiHeader({ name: 'X-Correlation-Id', required: false })
@ApiResponse({ status: 202, type: CheckoutAcceptedResponseDto })
@ApiResponse({ status: 200, type: CheckoutAcceptedResponseDto })
@ApiResponse({ status: 400, type: ApiErrorDto })
@ApiResponse({ status: 409, type: ApiErrorDto })
@ApiResponse({ status: 422, type: ApiErrorDto })
```

Repeat the same pattern for product, order, health, metrics, and admin controllers with their runtime response shapes.

- [ ] **Step 6: Run OpenAPI test and commit**

Run: `npm test -- --runTestsByPath tests/integration/openapi.int-spec.ts`

Expected: PASS.

```bash
git add package.json package-lock.json apps/api/src tests/helpers/create-api-test-app.ts tests/integration/openapi.int-spec.ts
git commit -m "feat: expose OpenAPI contract"
```

---

### Task 5: Instrument Product Cache and Redis Paths

**Files:**
- Modify: `libs/cache/src/cache.service.ts`
- Modify: `apps/api/src/products/products.service.ts`
- Test: `tests/integration/products.int-spec.ts`

- [ ] **Step 1: Add failing assertions to existing product cache tests**

Add this assertion to the existing cache hit/miss tests after calling `/products`:

```ts
const metrics = await request(app.getHttpServer()).get('/metrics').expect(200);
expect(metrics.text).toContain('cache_hits_total');
expect(metrics.text).toContain('cache_misses_total');
expect(metrics.text).toContain('redis_operation_duration_seconds');
```

Add a logger spy test for span emission:

```ts
it('emits cache and repo spans for product listing', async () => {
  const logger = app.get(LoggerService);
  const infoSpy = jest.spyOn(logger, 'info').mockImplementation(() => undefined);

  await request(app.getHttpServer()).get('/products').set('X-Correlation-Id', 'corr-products').expect(200);

  expect(infoSpy).toHaveBeenCalledWith(
    expect.objectContaining({
      event: 'span.finished',
      correlationId: 'corr-products',
      operation: expect.stringMatching(/cache|get|repo|products/)
    }),
    'span finished'
  );
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npm test -- --runTestsByPath tests/integration/products.int-spec.ts`

Expected: FAIL because Redis duration and trace spans are not emitted yet.

- [ ] **Step 3: Instrument `CacheService` operations**

Inject optional `MetricsService` and `TraceService` into `CacheService`. Wrap `getJson`, `setJson`, `getJsonMany`, `delete`, `acquireLock`, and `releaseLock` with:

```ts
private async observeRedis<T>(operation: string, callback: () => Promise<T>): Promise<T> {
  const startedAt = process.hrtime.bigint();

  try {
    const result = await this.traceService?.startSpan(`cache.${operation}`, callback) ?? await callback();
    this.metricsService?.recordRedisOperation({
      operation,
      outcome: result ? 'ok' : 'empty',
      durationSeconds: Number(process.hrtime.bigint() - startedAt) / 1_000_000_000
    });
    return result;
  } catch (error) {
    this.metricsService?.recordRedisOperation({
      operation,
      outcome: 'error',
      durationSeconds: Number(process.hrtime.bigint() - startedAt) / 1_000_000_000
    });
    throw error;
  }
}
```

Call it like:

```ts
async getJson<T>(key: string): Promise<T | null> {
  return this.observeRedis('get', async () => {
    const value = await this.redis.get(key);
    return value ? (JSON.parse(value) as T) : null;
  });
}
```

- [ ] **Step 4: Instrument product service hit/miss/repo spans**

In `ProductsService`, inject `LoggerService` and `TraceService`. Record cache hit/miss and wrap DB fetch:

```ts
this.metricsService?.recordCacheHit('products_query');
this.logger.info({ operation: 'products.cache_hit', cache: 'products_query' }, 'products cache hit');
```

```ts
this.metricsService?.recordCacheMiss('products_query');
this.logger.info({ operation: 'products.cache_miss', cache: 'products_query' }, 'products cache miss');
```

```ts
const items = await this.traceService.startSpan('repo.products.fetch', () =>
  this.fetchProducts(normalized)
);
```

- [ ] **Step 5: Run tests and commit**

Run: `npm test -- --runTestsByPath tests/integration/products.int-spec.ts`

Expected: PASS.

```bash
git add libs/cache/src/cache.service.ts apps/api/src/products/products.service.ts tests/integration/products.int-spec.ts
git commit -m "feat: instrument product cache path"
```

---

### Task 6: Instrument Checkout Path

**Files:**
- Modify: `apps/api/src/checkout/checkout.service.ts`
- Test: `tests/integration/checkout.int-spec.ts`

- [ ] **Step 1: Add failing checkout observability tests**

Add to `tests/integration/checkout.int-spec.ts`:

```ts
it('records checkout metrics and includes orderId in later context', async () => {
  const response = await request(app.getHttpServer())
    .post('/checkout')
    .set('X-Customer-Id', 'customer-observe')
    .set('Idempotency-Key', 'observe-key-1')
    .set('X-Correlation-Id', 'corr-checkout-observe')
    .send({ items: [{ productId: 'prod_case_iphone_15_clear', quantity: 1 }] })
    .expect(202);

  expect(response.body.orderId).toBeDefined();

  const metrics = await request(app.getHttpServer()).get('/metrics').expect(200);
  expect(metrics.text).toContain('checkout_started_total');
  expect(metrics.text).toContain('orders_accepted_total');
  expect(metrics.text).toContain('checkout_processing_duration_seconds');
});

it('records idempotency duplicate metric on replay', async () => {
  const payload = { items: [{ productId: 'prod_case_iphone_15_clear', quantity: 1 }] };

  await request(app.getHttpServer())
    .post('/checkout')
    .set('X-Customer-Id', 'customer-observe')
    .set('Idempotency-Key', 'observe-key-2')
    .send(payload)
    .expect(202);

  await request(app.getHttpServer())
    .post('/checkout')
    .set('X-Customer-Id', 'customer-observe')
    .set('Idempotency-Key', 'observe-key-2')
    .send(payload)
    .expect(200);

  const metrics = await request(app.getHttpServer()).get('/metrics').expect(200);
  expect(metrics.text).toContain('idempotency_duplicate_total');
});
```

- [ ] **Step 2: Run checkout tests to verify failure**

Run: `npm test -- --runTestsByPath tests/integration/checkout.int-spec.ts`

Expected: FAIL because checkout metrics and order context are not recorded.

- [ ] **Step 3: Instrument checkout service**

Inject `MetricsService`, `LoggerService`, `RequestContextService`, and `TraceService`. At checkout entry:

```ts
const startedAt = process.hrtime.bigint();
this.metricsService.recordCheckoutStarted();
this.logger.info({ operation: 'checkout.start', customerId, idempotencyKey }, 'checkout started');
```

Wrap the transaction:

```ts
const result = await this.traceService.startSpan('checkout.process', () =>
  this.runCheckoutTransactionWithRetry(() => this.prisma.$transaction(/* existing callback */))
);
```

When replaying completed idempotency:

```ts
this.metricsService.recordIdempotencyDuplicate();
this.requestContext.setOrderId(existing.orderId);
this.logger.info(
  { operation: 'checkout.idempotency_replay', customerId, orderId: existing.orderId },
  'checkout idempotency replay'
);
```

When order is created:

```ts
this.requestContext.setOrderId(order.id);
this.metricsService.recordCheckoutAccepted();
this.logger.info(
  { operation: 'checkout.accepted', customerId, orderId: order.id, totalCents },
  'checkout accepted'
);
```

When stock is insufficient:

```ts
this.metricsService.recordCheckoutRejectedOutOfStock();
this.logger.warn(
  { operation: 'checkout.rejected_out_of_stock', customerId, productId: item.productId },
  'checkout rejected out of stock'
);
```

In a `finally` block:

```ts
this.metricsService.recordCheckoutDuration({
  outcome: result?.httpStatus === 202 ? 'accepted' : result?.httpStatus === 200 ? 'idempotent' : 'error',
  durationSeconds: Number(process.hrtime.bigint() - startedAt) / 1_000_000_000
});
```

- [ ] **Step 4: Run checkout tests and commit**

Run: `npm test -- --runTestsByPath tests/integration/checkout.int-spec.ts`

Expected: PASS.

```bash
git add apps/api/src/checkout/checkout.service.ts tests/integration/checkout.int-spec.ts
git commit -m "feat: instrument checkout processing"
```

---

### Task 7: Propagate Context Through Outbox, RabbitMQ, and Order Worker

**Files:**
- Modify: `libs/queue/src/rabbit.service.ts`
- Modify: `apps/outbox-worker/src/outbox.publisher.ts`
- Modify: `apps/order-worker/src/billing.consumer.ts`
- Modify: `apps/order-worker/src/worker-runner.service.ts`
- Test: `tests/integration/workers.int-spec.ts`

- [ ] **Step 1: Add failing worker propagation tests**

Add assertions to the outbox publisher test:

```ts
expect(rabbit.publish).toHaveBeenCalledWith(
  'orders',
  'billing',
  expect.objectContaining({ orderId: 'order-1' }),
  expect.objectContaining({
    headers: expect.objectContaining({
      orderId: 'order-1',
      correlationId: expect.any(String),
      traceId: expect.any(String)
    })
  })
);
```

Add metrics assertion after DLQ path:

```ts
const metrics = moduleRef.get(MetricsService);
const output = await metrics.getMetrics();
expect(output).toContain('worker_retries_total');
expect(output).toContain('rabbitmq_dlq_messages');
expect(output).toContain('worker_processing_duration_seconds');
```

- [ ] **Step 2: Run worker tests to verify failure**

Run: `npm test -- --runTestsByPath tests/integration/workers.int-spec.ts`

Expected: FAIL because headers and metrics are missing.

- [ ] **Step 3: Extend Rabbit publish options and message metadata**

In `RabbitService.consumeJson`, pass headers to the handler:

```ts
type ConsumeControls = {
  ack: () => void;
  nack: (requeue?: boolean) => void;
  headers: Record<string, string>;
};
```

Set controls:

```ts
const controls: ConsumeControls = {
  ack: () => channel.ack(rawMessage),
  nack: (requeue = true) => channel.nack(rawMessage, false, requeue),
  headers: (rawMessage.properties.headers ?? {}) as Record<string, string>
};
```

Record queue gauges after `assertQueue`:

```ts
const main = await channel.assertQueue('orders.billing.q', { durable: true });
const dlq = await channel.assertQueue('orders.billing.dlq', { durable: true });
this.metricsService?.setRabbitQueueMessages('orders.billing.q', main.messageCount);
this.metricsService?.setRabbitDlqMessages('orders.billing.dlq', dlq.messageCount);
```

- [ ] **Step 4: Propagate context in outbox publisher**

Inject `RequestContextService`, `TraceService`, `MetricsService`, and `LoggerService`. Publish with correlation and trace headers:

```ts
const context = this.requestContext.get() ?? this.requestContext.create({
  correlationId: String(payload.correlationId ?? payload.idempotencyKey ?? event.id),
  traceId: String(payload.traceId ?? `trace_${event.id}`)
});

await this.requestContext.run(context, () =>
  this.traceService.startSpan('rabbitmq.publish.orders.billing', () =>
    this.rabbit.publish('orders', 'billing', payload, {
      messageId: event.id,
      headers: {
        orderId: String(payload.orderId ?? event.aggregateId),
        customerId: String(payload.customerId ?? ''),
        idempotencyKey: String(payload.idempotencyKey ?? ''),
        correlationId: context.correlationId,
        requestId: context.requestId,
        traceId: context.traceId
      }
    })
  )
);
this.metricsService.recordOutboxPublished();
```

On failure:

```ts
this.metricsService.recordOutboxPublishFailed();
this.logger.error(
  {
    operation: 'outbox.publish_failed',
    orderId: String(payload.orderId ?? event.aggregateId),
    error: error instanceof Error ? { message: error.message, stack: error.stack } : { message: String(error) }
  },
  'outbox publish failed'
);
```

- [ ] **Step 5: Restore context and instrument order worker**

At the start of `BillingConsumer.processWithRetry`:

```ts
const context = this.requestContext.create({
  correlationId: message.correlationId ?? message.idempotencyKey,
  traceId: message.traceId,
  orderId: message.orderId
});
const startedAt = process.hrtime.bigint();

return this.requestContext.run(context, async () => {
  try {
    await this.traceService.startSpan('worker.order_billing.process', () => this.processMessage(message));
    this.metricsService.recordWorkerProcessing({
      worker: 'order-worker',
      outcome: 'success',
      durationSeconds: Number(process.hrtime.bigint() - startedAt) / 1_000_000_000
    });
  } catch (error) {
    this.metricsService.recordWorkerRetry('order-worker');
    this.metricsService.recordWorkerProcessing({
      worker: 'order-worker',
      outcome: currentAttempt >= 4 ? 'dlq' : 'retry',
      durationSeconds: Number(process.hrtime.bigint() - startedAt) / 1_000_000_000
    });
    throw error;
  }
});
```

Extend `BillingMessage` with optional propagated fields:

```ts
correlationId?: string;
requestId?: string;
traceId?: string;
```

- [ ] **Step 6: Run worker tests and commit**

Run: `npm test -- --runTestsByPath tests/integration/workers.int-spec.ts`

Expected: PASS.

```bash
git add libs/queue/src/rabbit.service.ts apps/outbox-worker/src apps/order-worker/src tests/integration/workers.int-spec.ts
git commit -m "feat: propagate observability through workers"
```

---

### Task 8: Instrument Fake ERP Calls and Reconciliation

**Files:**
- Modify: `apps/order-worker/src/erp.client.ts`
- Modify: `apps/reconciliation-worker/src/erp-catalog.client.ts`
- Modify: `apps/reconciliation-worker/src/reconciliation.runner.ts`
- Test: `tests/integration/workers.int-spec.ts`

- [ ] **Step 1: Add failing ERP/reconciliation metrics assertions**

Add to worker integration tests after billing failure and reconciliation divergence cases:

```ts
const metrics = moduleRef.get(MetricsService);
const output = await metrics.getMetrics();
expect(output).toContain('erp_request_duration_seconds');
expect(output).toContain('erp_errors_total');
expect(output).toContain('reconciliation_divergences_total');
```

- [ ] **Step 2: Run worker tests to verify failure**

Run: `npm test -- --runTestsByPath tests/integration/workers.int-spec.ts`

Expected: FAIL until ERP and reconciliation metrics are recorded.

- [ ] **Step 3: Instrument ERP clients**

Wrap `fetch` calls:

```ts
const startedAt = process.hrtime.bigint();

try {
  const response = await this.traceService.startSpan('fake_erp.billing', () =>
    fetch(`${env.erpBaseUrl}/erp/billing`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ orderId, billingKey })
    })
  );

  this.metricsService.recordErpRequest({
    operation: 'billing',
    outcome: response.ok ? 'success' : 'error',
    durationSeconds: Number(process.hrtime.bigint() - startedAt) / 1_000_000_000
  });

  if (!response.ok) {
    this.metricsService.recordErpError('billing');
  }
} catch (error) {
  this.metricsService.recordErpError('billing');
  throw error;
}
```

Use operation name `catalog` in `getProducts`, `billing_status` in `getBillingStatus`, and `billing` in `billOrder`.

- [ ] **Step 4: Record reconciliation divergences**

In `ReconciliationRunner`, when a divergence is counted:

```ts
if (divergences > 0) {
  this.metricsService.recordReconciliationDivergence(divergences);
  this.logger.warn(
    { operation: 'reconciliation.divergence', divergences },
    'reconciliation divergences detected'
  );
}
```

- [ ] **Step 5: Run worker tests and commit**

Run: `npm test -- --runTestsByPath tests/integration/workers.int-spec.ts`

Expected: PASS.

```bash
git add apps/order-worker/src/erp.client.ts apps/reconciliation-worker/src tests/integration/workers.int-spec.ts
git commit -m "feat: instrument erp and reconciliation"
```

---

### Task 9: Complete README Operational Documentation

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add OpenAPI and observability documentation**

Add sections after "Quick Start":

```md
## API Contract

The API exposes:

- Swagger UI: `http://localhost:3000/docs`
- Raw OpenAPI JSON: `http://localhost:3000/openapi.json`

The contract documents success and error schemas. Error responses include `statusCode`, `error`, `message`, `requestId`, `correlationId`, and `orderId` when an order exists in the current flow.

## Observability

Every HTTP response includes:

- `X-Request-Id`: local request identifier generated by the API.
- `X-Correlation-Id`: caller-provided correlation id or an API-generated value.

Logs are JSON through Pino and include `service`, `operation`, `correlationId`, `requestId`, and `orderId` when available. The local trace implementation is a lightweight stub: spans are emitted as structured logs with `event=span.finished`. This keeps the demo self-contained without Jaeger, Datadog Agent, or an OpenTelemetry Collector. The `TraceService` boundary can be replaced with OpenTelemetry later without changing controllers and workers.
```

- [ ] **Step 2: Add dashboard, alerts, and runbook**

Add:

```md
## Dashboard Example

Catalog:

- p95 `http_request_duration_seconds{route="/products"}`
- cache hit ratio: `cache_hits_total / (cache_hits_total + cache_misses_total)`
- `product_card_hydration_misses_total`

Checkout:

- p95/p99 `checkout_processing_duration_seconds`
- `orders_accepted_total`
- `orders_rejected_out_of_stock_total`
- `idempotency_duplicate_total`

Queue and ERP:

- `outbox_pending_total`
- `outbox_publish_failed_total`
- `rabbitmq_queue_messages{queue="orders.billing.q"}`
- `rabbitmq_dlq_messages{queue="orders.billing.dlq"}`
- `worker_processing_duration_seconds`
- `erp_errors_total`

## Alerts

- Cache miss ratio above 40% for 10 minutes.
- p95 checkout latency above 1s for 5 minutes.
- `orders.billing.q` above 100 messages for 10 minutes.
- DLQ above 0 messages for 5 minutes.
- ERP errors increasing for 5 minutes.

## Runbook

Checkout errors or high latency:

1. Copy `X-Correlation-Id` or `X-Request-Id` from the client response.
2. Filter JSON logs by that id.
3. Check `checkout_processing_duration_seconds`, HTTP status mix, stock rows, idempotency rows, and Prisma `P2034` retry logs.

Cache miss spike:

1. Check Redis health and `cache_hits_total` / `cache_misses_total`.
2. Run `POST /admin/sync/erp` if the catalog version is stale.
3. Inspect `cache.get`, `cache.set`, and `repo.products.fetch` span logs.

Queue or DLQ growth:

1. Open RabbitMQ Management UI at `http://localhost:15672`.
2. Filter logs by `orderId` and `correlationId`.
3. Check `integration_attempts`, `erp_errors_total`, and fake ERP health.
4. Run `POST /admin/reconcile` after recovering the fake ERP.
```

- [ ] **Step 3: Add decisions, limitations, and AI prompts**

Add:

```md
## Decisions and Trade-offs

- The store reads catalog data from Postgres and Redis, not from the ERP, so storefront reads remain fast when the ERP is slow.
- Checkout uses local stock with atomic conditional updates to prevent overselling.
- Transactional outbox prevents a committed order from losing its billing event.
- RabbitMQ retry and DLQ demonstrate at-least-once processing without a large orchestration layer.
- The trace implementation is a local stub that logs spans; OpenTelemetry and Datadog export are future production integrations.

## Limitations

- `X-Customer-Id` stands in for authentication.
- No real payment flow.
- No CDC from ERP; sync is manual/admin-triggered in this demo.
- No reservation expiry or automatic stock return after permanent ERP failure.
- No admin endpoint for DLQ replay; use RabbitMQ UI and tests for the current demo.

## AI Prompts Used

- Initial architecture design for a backend demo decoupling an e-commerce store from an ERP.
- Follow-up prompt requiring OpenAPI, structured logs, metrics, trace/span coverage, and Datadog-equivalent runbook documentation.
```

- [ ] **Step 4: Commit README**

Run: `git diff --check -- README.md`

Expected: no whitespace errors.

```bash
git add README.md
git commit -m "docs: add operational runbook"
```

---

### Task 10: Final Verification

**Files:**
- Review: all changed files

- [ ] **Step 1: Run typecheck**

Run: `npm run typecheck`

Expected: PASS.

- [ ] **Step 2: Run integration suite**

Run: `npm test`

Expected: PASS.

- [ ] **Step 3: Build all Nest apps**

Run: `npm run build`

Expected: PASS.

- [ ] **Step 4: Inspect contract manually**

Run after starting stack:

```bash
curl -s http://localhost:3000/openapi.json | jq '.paths["/checkout"].post.responses'
```

Expected: output includes `200`, `202`, `400`, `409`, and `422`.

- [ ] **Step 5: Inspect metrics manually**

Run after a product request and checkout:

```bash
curl -s http://localhost:3000/metrics | rg 'cache_hits_total|cache_misses_total|checkout_processing_duration_seconds|outbox_published_total|worker_processing_duration_seconds'
```

Expected: matching metric names are present.

- [ ] **Step 6: Final commit if verification required mechanical fixes**

```bash
git add .
git commit -m "test: verify contract observability coverage"
```

Only create this commit if Step 1-5 required additional fixes.

---

## Self-Review

- Spec coverage: The plan covers OpenAPI success/error schemas, structured logs with correlation/request/order context, mandatory metrics, trace/span stub across request/cache/repo/fake ERP/queue/worker, and README dashboard/alerts/runbook/prompts.
- Placeholder scan: No `TBD`, `TODO`, or "implement later" instructions remain. Each task names files, test commands, expected failures, implementation snippets, and commit commands.
- Type consistency: Shared names are consistent across tasks: `RequestContextService`, `TraceService`, `MetricsService`, `requestId`, `correlationId`, `traceId`, `spanId`, `orderId`, and the metric names from the spec.
