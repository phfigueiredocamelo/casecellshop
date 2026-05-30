import { MetricsService } from '../../libs/observability/src/metrics.service';

describe('mandatory observability metrics', () => {
  it('registers the required operational metrics', async () => {
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
    metrics.recordWorkerProcessing({
      worker: 'order-worker',
      outcome: 'success',
      durationSeconds: 0.2
    });
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
