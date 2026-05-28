import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../libs/db/src';
import { RabbitModule } from '../../../libs/queue/src';
import { BillingConsumer } from './billing.consumer';
import { ErpBillingClient } from './erp.client';
import { WorkerRunnerService } from './worker-runner.service';

@Module({
  imports: [PrismaModule, RabbitModule],
  providers: [WorkerRunnerService, BillingConsumer, ErpBillingClient]
})
export class AppModule {}
