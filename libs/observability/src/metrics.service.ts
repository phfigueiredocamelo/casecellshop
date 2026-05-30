import { Injectable } from '@nestjs/common';
import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

@Injectable()
export class MetricsService {
  readonly registry = new Registry();
  readonly httpRequestDurationSeconds = new Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP request latency in seconds',
    labelNames: ['route', 'method', 'status'],
    registers: [this.registry]
  });
  readonly cacheHitsTotal = new Counter({
    name: 'cache_hits_total',
    help: 'Count of cache hits',
    labelNames: ['cache'],
    registers: [this.registry]
  });
  readonly cacheMissesTotal = new Counter({
    name: 'cache_misses_total',
    help: 'Count of cache misses',
    labelNames: ['cache'],
    registers: [this.registry]
  });
  readonly productCardHydrationMissesTotal = new Counter({
    name: 'product_card_hydration_misses_total',
    help: 'Count of product cards that could not be hydrated from cache refill',
    registers: [this.registry]
  });
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

  constructor() {
    collectDefaultMetrics({ register: this.registry });
  }

  recordHttpRequest(input: {
    route: string;
    method: string;
    status: number;
    durationSeconds: number;
  }) {
    this.httpRequestDurationSeconds
      .labels(input.route, input.method, String(input.status))
      .observe(input.durationSeconds);
  }

  recordCacheHit(cache: string) {
    this.cacheHitsTotal.labels(cache).inc();
  }

  recordCacheMiss(cache: string) {
    this.cacheMissesTotal.labels(cache).inc();
  }

  recordProductCardHydrationMiss(count: number) {
    this.productCardHydrationMissesTotal.inc(count);
  }

  recordRedisOperation(input: {
    operation: string;
    outcome: string;
    durationSeconds: number;
  }) {
    this.redisOperationDurationSeconds
      .labels(input.operation, input.outcome)
      .observe(input.durationSeconds);
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
    this.checkoutProcessingDurationSeconds
      .labels(input.outcome)
      .observe(input.durationSeconds);
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

  recordWorkerProcessing(input: {
    worker: string;
    outcome: string;
    durationSeconds: number;
  }) {
    this.workerProcessingDurationSeconds
      .labels(input.worker, input.outcome)
      .observe(input.durationSeconds);
  }

  recordWorkerRetry(worker: string) {
    this.workerRetriesTotal.labels(worker).inc();
  }

  recordErpRequest(input: { operation: string; outcome: string; durationSeconds: number }) {
    this.erpRequestDurationSeconds
      .labels(input.operation, input.outcome)
      .observe(input.durationSeconds);
  }

  recordErpError(operation: string) {
    this.erpErrorsTotal.labels(operation).inc();
  }

  recordReconciliationDivergence(count = 1) {
    this.reconciliationDivergencesTotal.inc(count);
  }

  async getMetrics() {
    return this.registry.metrics();
  }
}
