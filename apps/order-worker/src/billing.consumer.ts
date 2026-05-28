import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../libs/db/src';
import { RabbitService } from '../../../libs/queue/src';
import { ErpBillingClient } from './erp.client';

export interface BillingMessage {
  orderId: string;
  customerId: string;
  idempotencyKey: string;
  attempt?: number;
}

@Injectable()
export class BillingConsumer {
  constructor(
    private readonly prisma: PrismaService,
    private readonly erpClient: ErpBillingClient,
    private readonly rabbit: RabbitService
  ) {}

  async processMessage(message: BillingMessage) {
    const order = await this.prisma.order.findUniqueOrThrow({
      where: { id: message.orderId }
    });

    if (order.status === 'BILLED') {
      return {
        orderId: order.id,
        status: order.status
      };
    }

    const invoice = await this.erpClient.billOrder(order.id, `order:${order.id}:billing`);

    return this.prisma.order.update({
      where: { id: order.id },
      data: {
        status: 'BILLED',
        erpInvoiceId: invoice.invoiceId,
        failureReason: null
      }
    });
  }

  async processWithRetry(message: BillingMessage) {
    const currentAttempt = message.attempt ?? 1;

    try {
      await this.processMessage(message);
    } catch (error) {
      await this.prisma.integrationAttempt.create({
        data: {
          orderId: message.orderId,
          operation: 'billing',
          attemptNumber: currentAttempt,
          status: currentAttempt >= 4 ? 'DLQ' : 'FAILED',
          errorMessage: error instanceof Error ? error.message : String(error),
          correlationId: message.idempotencyKey
        }
      });

      if (currentAttempt >= 4) {
        await this.prisma.order.update({
          where: { id: message.orderId },
          data: {
            status: 'ERP_FAILED',
            failureReason: 'Moved to DLQ after retries'
          }
        });

        await this.rabbit.publishToDlq({
          orderId: message.orderId,
          idempotencyKey: message.idempotencyKey,
          customerId: message.customerId,
          attempt: currentAttempt
        });

        throw error;
      }

      await this.rabbit.publishToRetry({
        orderId: message.orderId,
        idempotencyKey: message.idempotencyKey,
        customerId: message.customerId,
        attempt: currentAttempt + 1
      });

      throw error;
    }
  }
}
