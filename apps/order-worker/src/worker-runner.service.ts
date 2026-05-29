import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy
} from '@nestjs/common';
import { BillingConsumer } from './billing.consumer';
import { RabbitService } from '../../../libs/queue/src';

@Injectable()
export class WorkerRunnerService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(WorkerRunnerService.name);
  private intervalHandle?: NodeJS.Timeout;
  private running = false;
  private consumerStarted = false;

  constructor(
    private readonly rabbit: RabbitService,
    private readonly billingConsumer: BillingConsumer
  ) {}

  async onApplicationBootstrap() {
    this.running = true;
    this.logger.log('order-worker bootstrap complete');
    this.intervalHandle = setInterval(() => {
      this.logger.debug('order-worker heartbeat');
      void this.ensureBillingConsumerStarted();
    }, Number(process.env.WORKER_HEARTBEAT_MS ?? 30000));
    void this.ensureBillingConsumerStarted();
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

  private async ensureBillingConsumerStarted() {
    if (this.consumerStarted) {
      return;
    }

    try {
      await this.rabbit.ensureTopology();
      await this.rabbit.consumeJson(
        'orders.billing.q',
        async (
          message: {
            orderId: string;
            customerId: string;
            idempotencyKey: string;
            attempt?: number;
          },
          controls: { ack: () => void }
        ) => {
          try {
            await this.billingConsumer.processWithRetry(message);
          } catch (error) {
            this.logger.error(
              `billing processing failed for ${message.orderId}`,
              error instanceof Error ? error.stack : undefined
            );
          } finally {
            controls.ack();
          }
        }
      );
      this.consumerStarted = true;
    } catch (error) {
      this.logger.error(
        'order-worker consumer startup failed',
        error instanceof Error ? error.stack : undefined
      );
    }
  }
}
