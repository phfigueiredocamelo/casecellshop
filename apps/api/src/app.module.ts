import { Module } from '@nestjs/common';
import { CacheModule } from '../../../libs/cache/src';
import { PrismaModule } from '../../../libs/db/src';
import { ErpCatalogClient } from '../../reconciliation-worker/src/erp-catalog.client';
import { CheckoutController } from './checkout/checkout.controller';
import { CheckoutService } from './checkout/checkout.service';
import { AdminController } from './admin/admin.controller';
import { HealthController } from './health.controller';
import { ObservabilityModule } from '../../../libs/observability/src';
import { ProductsController } from './products/products.controller';
import { ProductsService } from './products/products.service';
import { OrdersController } from './orders/orders.controller';
import { ReconciliationRunner } from '../../reconciliation-worker/src/reconciliation.runner';

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
export class AppModule {}
