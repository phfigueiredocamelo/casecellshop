import { Injectable } from '@nestjs/common';
import pino, { Logger } from 'pino';
import { env } from '../../config/src/env';

@Injectable()
export class LoggerService {
  private readonly logger: Logger = pino({
    level: env.logLevel,
    base: undefined,
    timestamp: pino.stdTimeFunctions.isoTime
  });

  info(payload: Record<string, unknown>, message: string) {
    this.logger.info(payload, message);
  }

  warn(payload: Record<string, unknown>, message: string) {
    this.logger.warn(payload, message);
  }

  error(payload: Record<string, unknown>, message: string) {
    this.logger.error(payload, message);
  }

  child(bindings: Record<string, unknown>) {
    return this.logger.child(bindings);
  }
}
