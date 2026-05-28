import { Injectable, OnModuleDestroy } from '@nestjs/common';
const amqplib = require('amqplib');
import { env } from '../../config/src';

type PublishOptions = {
  messageId?: string;
  headers?: Record<string, string>;
};

@Injectable()
export class RabbitService implements OnModuleDestroy {
  private connection?: any;
  private channel?: any;

  async onModuleDestroy() {
    await this.channel?.close().catch(() => undefined);
    await this.connection?.close().catch(() => undefined);
  }

  async ensureTopology() {
    const channel = await this.getChannel();

    await channel.assertExchange('orders', 'direct', { durable: true });
    await channel.assertQueue('orders.billing.q', { durable: true });
    await channel.assertQueue('orders.billing.retry.q', {
      durable: true,
      deadLetterExchange: 'orders',
      deadLetterRoutingKey: 'billing',
      messageTtl: 15000
    });
    await channel.assertQueue('orders.billing.dlq', { durable: true });
    await channel.bindQueue('orders.billing.q', 'orders', 'billing');
  }

  async publish(
    exchange: string,
    routingKey: string,
    payload: unknown,
    options: PublishOptions = {}
  ) {
    const channel = await this.getChannel();
    const buffer = Buffer.from(JSON.stringify(payload));

    channel.publish(exchange, routingKey, buffer, {
      contentType: 'application/json',
      persistent: true,
      ...options
    });
  }

  async publishToRetry(payload: unknown, options: PublishOptions = {}) {
    const channel = await this.getChannel();

    channel.sendToQueue('orders.billing.retry.q', Buffer.from(JSON.stringify(payload)), {
      contentType: 'application/json',
      persistent: true,
      ...options
    });
  }

  async publishToDlq(payload: unknown, options: PublishOptions = {}) {
    const channel = await this.getChannel();

    channel.sendToQueue('orders.billing.dlq', Buffer.from(JSON.stringify(payload)), {
      contentType: 'application/json',
      persistent: true,
      ...options
    });
  }

  private async getChannel() {
    if (this.channel) {
      return this.channel;
    }

    this.connection = await amqplib.connect(env.rabbitmqUrl);
    this.channel = await this.connection.createChannel();

    return this.channel;
  }
}
