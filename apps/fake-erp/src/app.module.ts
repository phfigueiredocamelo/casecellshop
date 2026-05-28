import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { BillingController } from './erp/billing.controller';
import { ErpController } from './erp/erp.controller';
import { ErpService } from './erp/erp.service';

@Module({
  controllers: [HealthController, ErpController, BillingController],
  providers: [ErpService]
})
export class AppModule {}
