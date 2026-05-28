import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../libs/db/src';
import { RabbitService } from '../../../libs/queue/src';

@Injectable()
export class OutboxPublisher {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rabbit: RabbitService
  ) {}

  async publishPending() {
    await this.rabbit.ensureTopology();

    const events = await this.prisma.outboxEvent.findMany({
      where: { status: 'PENDING' },
      orderBy: { createdAt: 'asc' },
      take: 50
    });

    for (const event of events) {
      try {
        const payload = event.payload as Record<string, unknown>;

        await this.rabbit.publish('orders', 'billing', payload, {
          messageId: event.id,
          headers: {
            orderId: String(payload.orderId ?? event.aggregateId),
            customerId: String(payload.customerId ?? ''),
            idempotencyKey: String(payload.idempotencyKey ?? '')
          }
        });

        await this.prisma.outboxEvent.update({
          where: { id: event.id },
          data: {
            status: 'PUBLISHED',
            publishedAt: new Date()
          }
        });
      } catch (error) {
        await this.prisma.outboxEvent.update({
          where: { id: event.id },
          data: {
            status: 'FAILED',
            attempts: {
              increment: 1
            },
            lastError: error instanceof Error ? error.message : String(error)
          }
        });
      }
    }
  }
}
