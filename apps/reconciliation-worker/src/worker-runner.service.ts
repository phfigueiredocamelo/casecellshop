import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy
} from '@nestjs/common';

@Injectable()
export class WorkerRunnerService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(WorkerRunnerService.name);
  private intervalHandle?: NodeJS.Timeout;
  private running = false;

  onApplicationBootstrap() {
    this.running = true;
    this.logger.log('reconciliation-worker bootstrap complete');
    this.intervalHandle = setInterval(() => {
      this.logger.debug('reconciliation-worker heartbeat');
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
}
