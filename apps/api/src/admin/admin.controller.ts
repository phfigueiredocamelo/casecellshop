import { Controller, Post } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ReconciliationRunner } from '../../../reconciliation-worker/src/reconciliation.runner';
import { ReconcileResponseDto, SyncErpResponseDto } from './dto/admin-response.dto';

@ApiTags('admin')
@Controller('admin')
export class AdminController {
  constructor(private readonly reconciliation: ReconciliationRunner) {}

  @Post('sync/erp')
  @ApiOperation({ summary: 'Synchronize ERP catalog data into the store mirror' })
  @ApiOkResponse({ type: SyncErpResponseDto })
  syncErp() {
    return this.reconciliation.syncCatalog();
  }

  @Post('reconcile')
  @ApiOperation({ summary: 'Run order reconciliation against the ERP' })
  @ApiOkResponse({ type: ReconcileResponseDto })
  reconcile() {
    return this.reconciliation.reconcileOrders();
  }
}
