import { Controller, Post } from '@nestjs/common';
import { ReconciliationRunner } from '../../../reconciliation-worker/src/reconciliation.runner';

@Controller('admin')
export class AdminController {
  constructor(private readonly reconciliation: ReconciliationRunner) {}

  @Post('sync/erp')
  syncErp() {
    return this.reconciliation.syncCatalog();
  }

  @Post('reconcile')
  reconcile() {
    return this.reconciliation.reconcileOrders();
  }
}
