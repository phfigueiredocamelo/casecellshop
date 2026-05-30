import { Injectable, Optional } from '@nestjs/common';
import { env } from '../../../libs/config/src';
import { MetricsService, TraceService } from '../../../libs/observability/src';

export interface BillingReceipt {
  invoiceId: string;
  billedAt: string;
}

@Injectable()
export class ErpBillingClient {
  constructor(
    @Optional() private readonly metricsService?: MetricsService,
    @Optional() private readonly traceService?: TraceService
  ) {}

  async billOrder(orderId: string, billingKey: string): Promise<BillingReceipt> {
    const startedAt = process.hrtime.bigint();
    let outcome: 'success' | 'error' = 'success';

    try {
      const response = await (this.traceService
        ? this.traceService.startSpan('fake_erp.billing', () =>
            fetch(`${env.erpBaseUrl}/erp/billing`, {
              method: 'POST',
              headers: {
                'content-type': 'application/json'
              },
              body: JSON.stringify({
                orderId,
                billingKey
              })
            })
          )
        : fetch(`${env.erpBaseUrl}/erp/billing`, {
            method: 'POST',
            headers: {
              'content-type': 'application/json'
            },
            body: JSON.stringify({
              orderId,
              billingKey
            })
          }));

      if (!response.ok) {
        outcome = 'error';
        throw new Error(`ERP billing request failed: ${response.status} ${response.statusText}`);
      }

      return (await response.json()) as BillingReceipt;
    } catch (error) {
      outcome = 'error';
      throw error;
    } finally {
      this.metricsService?.recordErpRequest({
        operation: 'billing',
        outcome,
        durationSeconds: Number(process.hrtime.bigint() - startedAt) / 1_000_000_000
      });

      if (outcome === 'error') {
        this.metricsService?.recordErpError('billing');
      }
    }
  }

  async getBillingStatus(orderId: string): Promise<BillingReceipt | null> {
    const startedAt = process.hrtime.bigint();
    let outcome: 'success' | 'not_found' | 'error' = 'success';

    try {
      const response = await (this.traceService
        ? this.traceService.startSpan('fake_erp.billing_status', () =>
            fetch(`${env.erpBaseUrl}/erp/billing/${orderId}`)
          )
        : fetch(`${env.erpBaseUrl}/erp/billing/${orderId}`));

      if (response.status === 404) {
        outcome = 'not_found';
        return null;
      }

      if (!response.ok) {
        outcome = 'error';
        throw new Error(`ERP billing status request failed: ${response.status} ${response.statusText}`);
      }

      const payload = (await response.json()) as BillingReceipt & { invoiceId: string | null };
      outcome = payload.invoiceId ? 'success' : 'not_found';
      if (!payload.invoiceId) {
        return null;
      }

      return payload;
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
