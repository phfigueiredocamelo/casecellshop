import { ReconciliationRunner } from '../../apps/reconciliation-worker/src/reconciliation.runner';
import { OutboxPublisher } from '../../apps/outbox-worker/src/outbox.publisher';
import { BillingConsumer } from '../../apps/order-worker/src/billing.consumer';
import { ErpService } from '../../apps/fake-erp/src/erp/erp.service';
import { ErpCatalogProduct } from '../../prisma/catalog-data';

describe('reconciliation worker catalog sync', () => {
  it('syncs products from fake ERP into the store mirror contract', async () => {
    const erpProducts: ErpCatalogProduct[] = [
      {
        id: 'prod-a',
        sku: 'SKU-A',
        name: 'Produto A',
        description: 'Descricao A',
        imageUrl: 'https://example.com/a.jpg',
        brand: 'CaseCell',
        active: true,
        priceCents: 8900,
        erpQty: 10,
        compatibilities: [
          {
            brand: 'Apple',
            model: 'iPhone 15',
            slug: 'apple-iphone-15'
          }
        ]
      }
    ];

    const productUpsert = jest.fn();
    const productPriceUpsert = jest.fn();
    const inventoryFindUnique = jest.fn().mockResolvedValue({
      productId: 'prod-a',
      reservedQty: 2
    });
    const inventoryUpsert = jest.fn();
    const productStatsUpsert = jest.fn();
    const productCompatibilityDeleteMany = jest.fn();
    const deviceModelUpsert = jest.fn();
    const deviceModelFindUniqueOrThrow = jest.fn().mockResolvedValue({
      id: 'device-a'
    });
    const productCompatibilityCreateMany = jest.fn();
    const productUpdateMany = jest.fn();
    const transaction = jest.fn(async (callback: (tx: any) => Promise<void>) => {
      await callback({
        inventory: {
          findUnique: inventoryFindUnique,
          upsert: inventoryUpsert
        },
        product: {
          upsert: productUpsert
        },
        productPrice: {
          upsert: productPriceUpsert
        },
        productStats: {
          upsert: productStatsUpsert
        },
        productCompatibility: {
          deleteMany: productCompatibilityDeleteMany,
          createMany: productCompatibilityCreateMany
        },
        deviceModel: {
          upsert: deviceModelUpsert,
          findUniqueOrThrow: deviceModelFindUniqueOrThrow
        }
      });
    });

    const cacheDelete = jest.fn().mockResolvedValue(undefined);
    const runner = new ReconciliationRunner(
      {
        $transaction: transaction,
        product: {
          updateMany: productUpdateMany
        },
        catalogVersion: {
          upsert: jest.fn().mockResolvedValue({
            key: 'catalog',
            version: 1
          })
        }
      } as any,
      {
        getProducts: jest.fn().mockResolvedValue(erpProducts)
      } as any,
      {
        delete: cacheDelete
      } as any
    );

    const result = await runner.syncCatalog();

    expect(result).toEqual({ synced: 1, catalogVersion: 1 });
    expect(productUpsert).toHaveBeenCalled();
    expect(productPriceUpsert).toHaveBeenCalled();
    expect(inventoryUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          erpQty: 10,
          availableQty: 8
        })
      })
    );
    expect(deviceModelUpsert).toHaveBeenCalled();
    expect(productCompatibilityCreateMany).toHaveBeenCalledWith({
      data: [{ productId: 'prod-a', deviceModelId: 'device-a' }]
    });
    expect(productUpdateMany).toHaveBeenCalledWith({
      where: {
        id: {
          notIn: ['prod-a']
        }
      },
      data: {
        active: false
      }
    });
    expect(cacheDelete).toHaveBeenCalledWith('product:availability:prod-a');
  });
});

describe('reconciliation worker order repair', () => {
  it('repairs billed orders based on ERP status', async () => {
    const orders = new Map<string, any>([
      [
        'order-1',
        {
          id: 'order-1',
          status: 'PENDING_ERP',
          erpInvoiceId: null,
          failureReason: 'waiting'
        }
      ],
      [
        'order-2',
        {
          id: 'order-2',
          status: 'ERP_FAILED',
          erpInvoiceId: null,
          failureReason: 'missing invoice'
        }
      ]
    ]);

    const orderFindMany = jest.fn().mockResolvedValue([...orders.values()]);
    const orderUpdate = jest.fn(async ({ where, data }: any) => {
      const current = orders.get(where.id);
      const updated = { ...current, ...data };
      orders.set(where.id, updated);
      return updated;
    });

    const runner = new ReconciliationRunner(
      {
        order: {
          findMany: orderFindMany,
          update: orderUpdate
        }
      } as any,
      {
        getBillingStatus: jest.fn(async (orderId: string) =>
          orderId === 'order-1'
            ? {
                invoiceId: 'inv-order-1',
                billedAt: new Date().toISOString()
              }
            : null
        )
      } as any,
      {
        delete: jest.fn().mockResolvedValue(undefined)
      } as any
    );

    const result = await runner.reconcileOrders();

    expect(result).toEqual({
      repaired: 1,
      divergences: 1
    });
    expect(orderUpdate).toHaveBeenCalledWith({
      where: { id: 'order-1' },
      data: {
        status: 'BILLED',
        erpInvoiceId: 'inv-order-1',
        failureReason: null
      }
    });
    expect(orders.get('order-1')?.status).toBe('BILLED');
  });
});

describe('outbox publisher', () => {
  it('publishes pending outbox events and marks them as published', async () => {
    const findMany = jest.fn().mockResolvedValue([
      {
        id: 'evt-1',
        aggregateType: 'Order',
        aggregateId: 'order-1',
        eventType: 'OrderAccepted',
        status: 'PENDING',
        payload: {
          orderId: 'order-1',
          customerId: 'customer-1',
          idempotencyKey: 'idem-1'
        },
        createdAt: new Date()
      }
    ]);
    const update = jest.fn().mockResolvedValue({});
    const publish = jest.fn().mockResolvedValue(undefined);
    const ensureTopology = jest.fn().mockResolvedValue(undefined);

    const publisher = new OutboxPublisher(
      {
        outboxEvent: {
          findMany,
          update
        }
      } as any,
      {
        ensureTopology,
        publish
      } as any
    );

    await publisher.publishPending();

    expect(ensureTopology).toHaveBeenCalled();
    expect(publish).toHaveBeenCalledWith(
      'orders',
      'billing',
      expect.objectContaining({
        orderId: 'order-1',
        customerId: 'customer-1',
        idempotencyKey: 'idem-1'
      }),
      expect.objectContaining({
        messageId: 'evt-1'
      })
    );
    expect(update).toHaveBeenCalledWith({
      where: { id: 'evt-1' },
      data: expect.objectContaining({
        status: 'PUBLISHED'
      })
    });
  });
});

describe('billing consumer', () => {
  function createPrismaStub(orderStatus: string = 'PENDING_ERP') {
    const orders = new Map<string, any>([
      [
        'order-1',
        {
          id: 'order-1',
          status: orderStatus,
          erpInvoiceId: null,
          failureReason: null
        }
      ],
      [
        'order-2',
        {
          id: 'order-2',
          status: orderStatus,
          erpInvoiceId: null,
          failureReason: null
        }
      ]
    ]);

    const updates: any[] = [];
    const integrationAttempts: any[] = [];

    return {
      orders,
      updates,
      integrationAttempts,
      prisma: {
        order: {
          findUniqueOrThrow: jest.fn(async ({ where }: any) => {
            const order = orders.get(where.id);
            if (!order) {
              throw new Error('not found');
            }

            return order;
          }),
          update: jest.fn(async ({ where, data }: any) => {
            const order = orders.get(where.id);
            const updated = { ...order, ...data };
            orders.set(where.id, updated);
            updates.push({ where, data });
            return updated;
          })
        },
        integrationAttempt: {
          create: jest.fn(async ({ data }: any) => {
            integrationAttempts.push(data);
            return data;
          })
        }
      }
    };
  }

  it('marks the order billed when the fake ERP accepts billing', async () => {
    const { prisma } = createPrismaStub();
    const erpService = new ErpService();
    const rabbit = {
      publishToRetry: jest.fn(),
      publishToDlq: jest.fn()
    };
    const consumer = new BillingConsumer(prisma as any, erpService as any, rabbit as any);

    await consumer.processMessage({
      orderId: 'order-1',
      customerId: 'customer-1',
      idempotencyKey: 'idem-1'
    });

    const order = await prisma.order.findUniqueOrThrow({ where: { id: 'order-1' } });
    expect(order.status).toBe('BILLED');
    expect(order.erpInvoiceId).toBe('inv-order-1');
  });

  it('moves poison messages to the DLQ after max attempts', async () => {
    const { prisma, integrationAttempts } = createPrismaStub();
    const erpService = new ErpService();
    erpService.enableBillingFailure('order-2');
    const rabbit = {
      publishToRetry: jest.fn(),
      publishToDlq: jest.fn()
    };
    const consumer = new BillingConsumer(prisma as any, erpService as any, rabbit as any);

    await expect(
      consumer.processWithRetry({
        orderId: 'order-2',
        customerId: 'customer-1',
        idempotencyKey: 'idem-2',
        attempt: 4
      })
    ).rejects.toThrow();

    expect(rabbit.publishToDlq).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: 'order-2',
        attempt: 4
      })
    );
    expect(integrationAttempts).toHaveLength(1);
    expect(integrationAttempts[0]).toMatchObject({
      orderId: 'order-2',
      operation: 'billing',
      attemptNumber: 4,
      status: 'DLQ'
    });
  });
});
