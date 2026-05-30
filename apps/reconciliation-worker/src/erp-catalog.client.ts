import { Injectable } from '@nestjs/common';
import { env } from '../../../libs/config/src';
import { MetricsService, TraceService } from '../../../libs/observability/src';
import { ErpCatalogProduct } from '../../../prisma/catalog-data';

@Injectable()
export class ErpCatalogClient {
  constructor(
    private readonly metricsService?: MetricsService,
    private readonly traceService?: TraceService
  ) {}

  async getProducts(): Promise<ErpCatalogProduct[]> {
    const startedAt = process.hrtime.bigint();
    let outcome: 'success' | 'error' = 'success';

    try {
      const response = await (this.traceService
        ? this.traceService.startSpan('fake_erp.catalog', () => fetch(`${env.erpBaseUrl}/erp/products`))
        : fetch(`${env.erpBaseUrl}/erp/products`));

      if (!response.ok) {
        outcome = 'error';
        throw new Error(`ERP catalog request failed: ${response.status} ${response.statusText}`);
      }

      return (await response.json()) as ErpCatalogProduct[];
    } catch (error) {
      outcome = 'error';
      throw error;
    } finally {
      this.metricsService?.recordErpRequest({
        operation: 'catalog',
        outcome,
        durationSeconds: Number(process.hrtime.bigint() - startedAt) / 1_000_000_000
      });

      if (outcome === 'error') {
        this.metricsService?.recordErpError('catalog');
      }
    }
  }

  async getBillingStatus(orderId: string): Promise<{ invoiceId: string | null; billedAt?: string } | null> {
    const startedAt = process.hrtime.bigint();
    let outcome: 'success' | 'not_found' | 'error' = 'success';

    try {
      const response = await (this.traceService
        ? this.traceService.startSpan('fake_erp.billing_status', () =>
            fetch(`${env.erpBaseUrl}/erp/billing/${orderId}`)
          )
        : fetch(`${env.erpBaseUrl}/erp/billing/${orderId}`));

      if (!response.ok) {
        if (response.status === 404) {
          outcome = 'not_found';
          return null;
        }

        outcome = 'error';
        throw new Error(`ERP billing status request failed: ${response.status} ${response.statusText}`);
      }

      const payload = (await response.json()) as { invoiceId: string | null; billedAt?: string };
      outcome = payload.invoiceId ? 'success' : 'not_found';
      return payload.invoiceId ? payload : null;
    } catch (error) {
      outcome = 'error';
      throw error;
    } finally {
      this.metricsService?.recordErpRequest({
        operation: 'billing_status',
        outcome,
        durationSeconds: Number(process.hrtime.bigint() - startedAt) / 1_000_000_000
      });

      if (outcome === 'error') {
        this.metricsService?.recordErpError('billing_status');
      }
    }
  }
}
