import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnprocessableEntityException
} from '@nestjs/common';
import { IdempotencyStatus, Prisma, OrderStatus } from '@prisma/client';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../../../libs/db/src';
import { ProductsService } from '../products/products.service';

export interface CheckoutItemInput {
  productId: string;
  quantity: number;
}

export interface CheckoutRequest {
  items: CheckoutItemInput[];
}

export interface CheckoutAcceptedResponse {
  orderId: string;
  status: OrderStatus;
  totalCents: number;
  currency: string;
}

export interface CheckoutResult {
  httpStatus: number;
  body: CheckoutAcceptedResponse;
}

interface PricedItem {
  productId: string;
  sku: string;
  productName: string;
  quantity: number;
  unitPriceCents: number;
}

@Injectable()
export class CheckoutService {
  private readonly checkoutRetryAttempts = 4;
  private readonly checkoutRetryBaseDelayMs = 25;

  constructor(
    private readonly prisma: PrismaService,
    private readonly productsService: ProductsService
  ) {}

  async checkout(
    customerId: string | undefined,
    idempotencyKey: string | undefined,
    body: CheckoutRequest
  ): Promise<CheckoutResult> {
    if (!customerId) {
      throw new BadRequestException('Missing X-Customer-Id header');
    }

    if (!idempotencyKey) {
      throw new BadRequestException('Missing Idempotency-Key header');
    }

    this.validateRequest(body);

    const normalizedBody = this.normalizeRequest(body);
    const requestHash = this.hashRequest(normalizedBody);
    const cacheKeysToInvalidate = normalizedBody.items.map((item) => item.productId);
    const idempotencyLockKey = `${customerId}:${idempotencyKey}`;
    const inventoryLockKeys = [...new Set(normalizedBody.items.map((item) => item.productId))].sort();

    const result = await this.runCheckoutTransactionWithRetry(() =>
      this.prisma.$transaction(
        async (tx) => {
          await this.acquireIdempotencyLock(tx, idempotencyLockKey);
          await this.acquireInventoryLocks(tx, inventoryLockKeys);

          const existing = await tx.idempotencyKey.findUnique({
            where: {
              customerId_key: {
                customerId,
                key: idempotencyKey
              }
            }
          });

          if (existing && existing.requestHash !== requestHash) {
            throw new ConflictException('Idempotency key reused with different payload');
          }

          if (existing?.status === IdempotencyStatus.COMPLETED && existing.responseBody) {
            return {
              httpStatus: 200,
              body: existing.responseBody as unknown as CheckoutAcceptedResponse
            };
          }

          if (existing?.status === IdempotencyStatus.PROCESSING) {
            throw new ConflictException('Checkout already in progress for this idempotency key');
          }

          const products = await tx.product.findMany({
            where: {
              id: {
                in: normalizedBody.items.map((item) => item.productId)
              },
              active: true
            },
            include: {
              price: true
            }
          });

          if (products.length !== normalizedBody.items.length) {
            throw new UnprocessableEntityException('One or more products are unavailable');
          }

          const pricedItems: PricedItem[] = normalizedBody.items.map((item) => {
            const product = products.find((candidate) => candidate.id === item.productId);

            if (!product?.price) {
              throw new UnprocessableEntityException(`Product ${item.productId} has no price`);
            }

            return {
              productId: product.id,
              sku: product.sku,
              productName: product.name,
              quantity: item.quantity,
              unitPriceCents: product.price.priceCents
            };
          });

          for (const item of normalizedBody.items) {
            const updated = await tx.inventory.updateMany({
              where: {
                productId: item.productId,
                availableQty: {
                  gte: item.quantity
                }
              },
              data: {
                availableQty: {
                  decrement: item.quantity
                },
                reservedQty: {
                  increment: item.quantity
                },
                version: {
                  increment: 1
                }
              }
            });

            if (updated.count !== 1) {
              throw new UnprocessableEntityException('Insufficient stock');
            }
          }

          const totalCents = pricedItems.reduce(
            (sum, item) => sum + item.quantity * item.unitPriceCents,
            0
          );

          const order = await tx.order.create({
            data: {
              customerId,
              idempotencyKey,
              status: OrderStatus.PENDING_ERP,
              totalCents,
              currency: 'BRL',
              items: {
                create: pricedItems.map((item) => ({
                  productId: item.productId,
                  sku: item.sku,
                  productName: item.productName,
                  quantity: item.quantity,
                  unitPriceCents: item.unitPriceCents
                }))
              }
            },
            include: {
              items: true
            }
          });

          const responseBody: CheckoutAcceptedResponse = {
            orderId: order.id,
            status: order.status,
            totalCents: order.totalCents,
            currency: order.currency
          };

          await tx.outboxEvent.create({
            data: {
              aggregateType: 'Order',
              aggregateId: order.id,
              eventType: 'OrderAccepted',
              payload: {
                orderId: order.id,
                customerId,
                idempotencyKey,
                totalCents: order.totalCents,
                currency: order.currency
              },
              status: 'PENDING',
              orderId: order.id
            }
          });

          await tx.idempotencyKey.create({
            data: {
              customerId,
              key: idempotencyKey,
              requestHash,
              orderId: order.id,
              status: IdempotencyStatus.COMPLETED,
              responseBody: responseBody as unknown as Prisma.InputJsonValue
            }
          });

          return {
            httpStatus: 202,
            body: responseBody
          };
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable
        }
      )
    );

    await this.productsService.invalidateAvailability(cacheKeysToInvalidate);

    return result;
  }

  private validateRequest(body: CheckoutRequest) {
    if (!body?.items?.length) {
      throw new BadRequestException('Checkout requires at least one item');
    }

    for (const item of body.items) {
      if (!item.productId || item.quantity <= 0 || !Number.isInteger(item.quantity)) {
        throw new BadRequestException('Invalid checkout item');
      }
    }
  }

  private normalizeRequest(body: CheckoutRequest): CheckoutRequest {
    return {
      items: [...body.items]
        .map((item) => ({
          productId: item.productId,
          quantity: item.quantity
        }))
        .sort((left, right) => left.productId.localeCompare(right.productId))
    };
  }

  private hashRequest(body: CheckoutRequest) {
    return createHash('sha256').update(JSON.stringify(body)).digest('hex');
  }

  private async runCheckoutTransactionWithRetry<T>(operation: () => Promise<T>): Promise<T> {
    let attempt = 0;

    while (true) {
      try {
        return await operation();
      } catch (error) {
        if (!this.isRetryableTransactionError(error) || attempt >= this.checkoutRetryAttempts - 1) {
          throw error;
        }

        const delayMs = this.checkoutRetryBaseDelayMs * 2 ** attempt;
        attempt += 1;
        await this.delay(delayMs);
      }
    }
  }

  private isRetryableTransactionError(error: unknown) {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: string }).code === 'P2034'
    );
  }

  private async delay(ms: number) {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, ms);
    });
  }

  private async acquireIdempotencyLock(tx: Prisma.TransactionClient, lockKey: string) {
    await this.acquireAdvisoryLock(tx, lockKey);
  }

  private async acquireInventoryLocks(tx: Prisma.TransactionClient, productIds: string[]) {
    for (const productId of productIds) {
      await this.acquireAdvisoryLock(tx, `inventory:${productId}`);
    }
  }

  private async acquireAdvisoryLock(tx: Prisma.TransactionClient, lockKey: string) {
    if (typeof (tx as Prisma.TransactionClient & { $executeRaw?: unknown }).$executeRaw !== 'function') {
      return;
    }

    await (tx as Prisma.TransactionClient & {
      $executeRaw: (query: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>;
    }).$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
  }
}
