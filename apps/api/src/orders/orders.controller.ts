import { Controller, Get, Headers, NotFoundException, Param } from '@nestjs/common';
import {
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags
} from '@nestjs/swagger';
import { PrismaService } from '../../../../libs/db/src';
import {
  IdempotencyEntryResponseDto,
  OrderResponseDto
} from './dto/order-response.dto';

@ApiTags('orders')
@Controller('orders')
export class OrdersController {
  constructor(private readonly prisma: PrismaService) {}

  @Get(':id')
  @ApiOperation({ summary: 'Get an order by id' })
  @ApiOkResponse({ type: OrderResponseDto })
  @ApiNotFoundResponse({ description: 'Order not found' })
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
  @ApiOperation({ summary: 'Get an order by idempotency key' })
  @ApiHeader({ name: 'X-Customer-Id', required: true })
  @ApiOkResponse({ type: IdempotencyEntryResponseDto })
  @ApiNotFoundResponse({ description: 'Idempotency key not found' })
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
