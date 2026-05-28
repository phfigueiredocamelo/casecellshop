import { Injectable } from '@nestjs/common';
import { env } from '../../../libs/config/src';

export interface BillingReceipt {
  invoiceId: string;
  billedAt: string;
}

@Injectable()
export class ErpBillingClient {
  async billOrder(orderId: string, billingKey: string): Promise<BillingReceipt> {
    const response = await fetch(`${env.erpBaseUrl}/erp/billing`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        orderId,
        billingKey
      })
    });

    if (!response.ok) {
      throw new Error(`ERP billing request failed: ${response.status} ${response.statusText}`);
    }

    return (await response.json()) as BillingReceipt;
  }

  async getBillingStatus(orderId: string): Promise<BillingReceipt | null> {
    const response = await fetch(`${env.erpBaseUrl}/erp/billing/${orderId}`);

    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      throw new Error(`ERP billing status request failed: ${response.status} ${response.statusText}`);
    }

    const payload = (await response.json()) as BillingReceipt & { invoiceId: string | null };

    if (!payload.invoiceId) {
      return null;
    }

    return payload;
  }
}
