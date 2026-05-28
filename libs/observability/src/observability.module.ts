import { Global, Module } from '@nestjs/common';
import { LoggerModule } from './logger.module';
import { MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';

@Global()
@Module({
  imports: [LoggerModule],
  controllers: [MetricsController],
  providers: [MetricsService],
  exports: [LoggerModule, MetricsService]
})
export class ObservabilityModule {}
