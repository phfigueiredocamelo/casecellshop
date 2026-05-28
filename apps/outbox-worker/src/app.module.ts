import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../libs/db/src';
import { RabbitModule } from '../../../libs/queue/src';
import { OutboxPublisher } from './outbox.publisher';
import { WorkerRunnerService } from './worker-runner.service';

@Module({
  imports: [PrismaModule, RabbitModule],
  providers: [WorkerRunnerService, OutboxPublisher]
})
export class AppModule {}
