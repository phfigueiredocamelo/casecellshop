import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy
} from '@nestjs/common';
import { OutboxPublisher } from './outbox.publisher';

@Injectable()
export class WorkerRunnerService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(WorkerRunnerService.name);
  private intervalHandle?: NodeJS.Timeout;
  private running = false;

  constructor(private readonly outboxPublisher: OutboxPublisher) {}

  async onApplicationBootstrap() {
    this.running = true;
    this.logger.log('outbox-worker bootstrap complete');
    await this.flushPendingOutbox();
    this.intervalHandle = setInterval(() => {
      void this.flushPendingOutbox();
    }, Number(process.env.WORKER_HEARTBEAT_MS ?? 30000));
  }

  onModuleDestroy() {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
    }

    this.running = false;
  }

  isRunning() {
    return this.running;
  }

  private async flushPendingOutbox() {
    if (!this.running) {
      return;
    }

    try {
      await this.outboxPublisher.publishPending();
    } catch (error) {
      this.logger.error(
        'outbox-worker publish cycle failed',
        error instanceof Error ? error.stack : undefined
      );
    }
  }
}
