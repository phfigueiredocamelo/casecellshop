import { Global, Module } from '@nestjs/common';
import { RequestContextService } from './request-context.service';
import { LoggerService } from './logger.service';

@Global()
@Module({
  providers: [LoggerService, RequestContextService],
  exports: [LoggerService, RequestContextService]
})
export class LoggerModule {}
