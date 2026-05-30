import { ErpBillingClient } from '../../apps/order-worker/src/erp.client';
import { ErpCatalogClient } from '../../apps/reconciliation-worker/src/erp-catalog.client';
import { ReconciliationRunner } from '../../apps/reconciliation-worker/src/reconciliation.runner';
import { LoggerService } from '../../libs/observability/src/logger.service';
import { MetricsService } from '../../libs/observability/src/metrics.service';
import { RequestContextService } from '../../libs/observability/src/request-context.service';
import { TraceService } from '../../libs/observability/src/trace.service';

function mockResponse<T>(
  body: T,
  options: { ok?: boolean; status?: number; statusText?: string } = {}
) {
  return {
    ok: options.ok ?? true,
    status: options.status ?? 200,
    statusText: options.statusText ?? 'OK',
    json: async () => body
  } as any;
}

describe('ERP observability', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('records catalog and billing ERP request metrics and spans', async () => {
    const requestContext = new RequestContextService();
    const logger = new LoggerService(requestContext);
    const trace = new TraceService(requestContext, logger);
    const metrics = new MetricsService();
    const traceSpy = jest.spyOn(trace, 'startSpan').mockImplementation(async (_op, callback) => callback());
    const fetchSpy = jest.spyOn(globalThis as any, 'fetch');
    fetchSpy
      .mockResolvedValueOnce(
        mockResponse([
          {
            id: 'prod-1',
            sku: 'SKU-1',
            name: 'Produto 1',
            description: 'desc',
            imageUrl: null,
            brand: 'CaseCell',
            active: true,
            priceCents: 1000,
            erpQty: 1,
            compatibilities: []
          }
        ])
      )
      .mockResolvedValueOnce(
        mockResponse(
          {
            invoiceId: 'inv-order-1',
            billedAt: new Date().toISOString()
          },
          { ok: true }
        )
      )
      .mockResolvedValueOnce(mockResponse({ invoiceId: null }, { ok: false, status: 404, statusText: 'Not Found' }));

    const catalogClient = new ErpCatalogClient(metrics, trace);
    const billingClient = new ErpBillingClient(metrics, trace);

    const products = await catalogClient.getProducts();
    const receipt = await billingClient.billOrder('order-1', 'billing-key-1');
    const billingStatus = await billingClient.getBillingStatus('order-2');

    expect(products).toHaveLength(1);
    expect(receipt).toMatchObject({
      invoiceId: 'inv-order-1'
    });
    expect(billingStatus).toBeNull();
    expect(traceSpy).toHaveBeenCalledWith('fake_erp.catalog', expect.any(Function));
    expect(traceSpy).toHaveBeenCalledWith('fake_erp.billing', expect.any(Function));
    expect(traceSpy).toHaveBeenCalledWith('fake_erp.billing_status', expect.any(Function));

    const metricsOutput = await metrics.getMetrics();
    expect(metricsOutput).toContain('erp_request_duration_seconds');
    expect(metricsOutput).toContain('erp_errors_total');
  });

  it('records reconciliation divergences when ERP does not have billing data', async () => {
    const logger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn()
    };
    const metrics = {
      recordReconciliationDivergence: jest.fn()
    };

    const runner = new ReconciliationRunner(
      {
        order: {
          findMany: jest.fn().mockResolvedValue([
            {
              id: 'order-1',
              status: 'PENDING_ERP'
            }
          ]),
          update: jest.fn()
        }
      } as any,
      {
        getBillingStatus: jest.fn().mockResolvedValue(null)
      } as any,
      {
        delete: jest.fn()
      } as any,
      metrics as any,
      logger as any
    );

    const result = await runner.reconcileOrders();

    expect(result).toEqual({
      repaired: 0,
      divergences: 1
    });
    expect(metrics.recordReconciliationDivergence).toHaveBeenCalledWith(1);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'reconciliation.divergence',
        divergences: 1
      }),
      'reconciliation divergences detected'
    );
  });
});
