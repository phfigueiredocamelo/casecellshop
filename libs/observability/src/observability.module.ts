import { Global, Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { HttpErrorFilter } from './http-error.filter';
import { HttpMetricsInterceptor } from './http-metrics.interceptor';
import { LoggerModule } from './logger.module';
import { MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';
import { RequestContextMiddleware } from './request-context.middleware';

@Global()
@Module({
  imports: [LoggerModule],
  controllers: [MetricsController],
  providers: [
    MetricsService,
    RequestContextMiddleware,
    HttpErrorFilter,
    HttpMetricsInterceptor,
    {
      provide: APP_INTERCEPTOR,
      useExisting: HttpMetricsInterceptor
    },
    {
      provide: APP_FILTER,
      useExisting: HttpErrorFilter
    }
  ],
  exports: [
    LoggerModule,
    MetricsService,
    RequestContextMiddleware
  ]
})
export class ObservabilityModule {}
