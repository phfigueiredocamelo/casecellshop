import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { buildDemoCatalog, ErpCatalogProduct } from '../../../../prisma/catalog-data';

export interface BillingReceipt {
  invoiceId: string;
  billedAt: string;
}

@Injectable()
export class ErpService {
  private catalog: ErpCatalogProduct[] = buildDemoCatalog();
  private readonly failBillingFor = new Set<string>();
  private readonly billingByKey = new Map<string, BillingReceipt>();
  private readonly billingByOrderId = new Map<string, BillingReceipt>();

  getProducts() {
    return this.catalog;
  }

  setCatalog(products: ErpCatalogProduct[]) {
    this.catalog = products;

    return {
      count: this.catalog.length
    };
  }

  enableBillingFailure(orderId: string) {
    this.failBillingFor.add(orderId);
  }

  clearBillingFailure(orderId: string) {
    this.failBillingFor.delete(orderId);
  }

  async billOrder(orderId: string, billingKey: string): Promise<BillingReceipt> {
    if (this.failBillingFor.has(orderId)) {
      throw new ServiceUnavailableException('Simulated ERP billing failure');
    }

    const existing = this.billingByKey.get(billingKey);
    if (existing) {
      return existing;
    }

    const receipt = {
      invoiceId: `inv-${orderId}`,
      billedAt: new Date().toISOString()
    };

    this.billingByKey.set(billingKey, receipt);
    this.billingByOrderId.set(orderId, receipt);

    return receipt;
  }

  getBillingStatus(orderId: string) {
    return this.billingByOrderId.get(orderId) ?? null;
  }
}
