import { Injectable } from '@nestjs/common';
import { env } from '../../../libs/config/src';
import { ErpCatalogProduct } from '../../../prisma/catalog-data';

@Injectable()
export class ErpCatalogClient {
  async getProducts(): Promise<ErpCatalogProduct[]> {
    const response = await fetch(`${env.erpBaseUrl}/erp/products`);

    if (!response.ok) {
      throw new Error(`ERP catalog request failed: ${response.status} ${response.statusText}`);
    }

    return (await response.json()) as ErpCatalogProduct[];
  }

  async getBillingStatus(orderId: string): Promise<{ invoiceId: string | null; billedAt?: string } | null> {
    const response = await fetch(`${env.erpBaseUrl}/erp/billing/${orderId}`);

    if (!response.ok) {
      if (response.status === 404) {
        return null;
      }

      throw new Error(`ERP billing status request failed: ${response.status} ${response.statusText}`);
    }

    const payload = (await response.json()) as { invoiceId: string | null; billedAt?: string };

    return payload.invoiceId ? payload : null;
  }
}
