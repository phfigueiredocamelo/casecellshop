import { Module } from '@nestjs/common';
import { CacheModule } from '../../../libs/cache/src';
import { PrismaModule } from '../../../libs/db/src';
import { ErpCatalogClient } from './erp-catalog.client';
import { ReconciliationRunner } from './reconciliation.runner';
import { WorkerRunnerService } from './worker-runner.service';

@Module({
  imports: [PrismaModule, CacheModule],
  providers: [WorkerRunnerService, ErpCatalogClient, ReconciliationRunner]
})
export class AppModule {}
