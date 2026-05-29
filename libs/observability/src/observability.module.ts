import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { HttpMetricsInterceptor } from './http-metrics.interceptor';
import { LoggerModule } from './logger.module';
import { MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';

@Global()
@Module({
  imports: [LoggerModule],
  controllers: [MetricsController],
  providers: [
    MetricsService,
    HttpMetricsInterceptor,
    {
      provide: APP_INTERCEPTOR,
      useExisting: HttpMetricsInterceptor
    }
  ],
  exports: [LoggerModule, MetricsService]
})
export class ObservabilityModule {}
