import { Controller, Get, Headers, NotFoundException, Param } from '@nestjs/common';
import { PrismaService } from '../../../../libs/db/src';

@Controller('orders')
export class OrdersController {
  constructor(private readonly prisma: PrismaService) {}

  @Get(':id')
  async getById(@Param('id') id: string) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: {
        items: true,
        outboxEvents: true,
        attempts: true
      }
    });

    if (!order) {
      throw new NotFoundException(`Order ${id} not found`);
    }

    return order;
  }

  @Get('by-idempotency-key/:key')
  async getByIdempotencyKey(
    @Headers('x-customer-id') customerId: string | undefined,
    @Param('key') key: string
  ) {
    if (!customerId) {
      throw new NotFoundException('Missing customer scope');
    }

    const entry = await this.prisma.idempotencyKey.findUnique({
      where: {
        customerId_key: {
          customerId,
          key
        }
      }
    });

    if (!entry) {
      throw new NotFoundException(`Idempotency key ${key} not found`);
    }

    return entry;
  }
}
