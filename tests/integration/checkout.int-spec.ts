import { CheckoutService } from '../../apps/api/src/checkout/checkout.service';
import { CheckoutController } from '../../apps/api/src/checkout/checkout.controller';

describe('checkout', () => {
  function createPrismaStub(
    options: { inventoryUpdateFailures?: number; captureLocks?: boolean } = {}
  ) {
    const state = {
      idempotencyByKey: new Map<string, any>(),
      orders: new Map<string, any>(),
      inventories: new Map<string, any>(),
      products: new Map<string, any>(),
      outbox: [] as any[],
      locks: [] as string[],
      transactionCalls: 0,
      inventoryUpdateFailures: options.inventoryUpdateFailures ?? 0
    };

    state.products.set('prod-1', {
      id: 'prod-1',
      sku: 'SKU-1',
      name: 'Capa iPhone 15',
      active: true,
      price: { priceCents: 5990, currency: 'BRL' }
    });
    state.products.set('prod-hot', {
      id: 'prod-hot',
      sku: 'SKU-HOT',
      name: 'Produto quente',
      active: true,
      price: { priceCents: 1000, currency: 'BRL' }
    });
    state.inventories.set('prod-1', {
      productId: 'prod-1',
      availableQty: 5,
      reservedQty: 0,
      version: 1
    });
    state.inventories.set('prod-hot', {
      productId: 'prod-hot',
      availableQty: 1,
      reservedQty: 0,
      version: 1
    });

    const txFactory = async (callback: (tx: any) => Promise<any>) => callback({
      $executeRaw: options.captureLocks
        ? async (_query: TemplateStringsArray, ...values: unknown[]) => {
            state.locks.push(String(values[0]));
            return undefined;
          }
        : undefined,
      idempotencyKey: {
        async findUnique({ where }: any) {
          const key = `${where.customerId_key.customerId}:${where.customerId_key.key}`;
          return state.idempotencyByKey.get(key) ?? null;
        },
        async create({ data }: any) {
          const key = `${data.customerId}:${data.key}`;
          const entry = {
            ...data
          };
          state.idempotencyByKey.set(key, entry);
          return entry;
        }
      },
      product: {
        async findMany({ where }: any) {
          const ids = where.id.in;
          return ids
            .map((id: string) => state.products.get(id))
            .filter((product: any) => product && product.active && (!where.active || product.active));
        }
      },
      inventory: {
        async updateMany({ where, data }: any) {
          if (state.inventoryUpdateFailures > 0) {
            state.inventoryUpdateFailures -= 1;
            const error = new Error('Transaction failed due to a write conflict or a deadlock');
            (error as Error & { code?: string }).code = 'P2034';
            throw error;
          }

          const inventory = state.inventories.get(where.productId);
          if (!inventory || inventory.availableQty < where.availableQty.gte) {
            return { count: 0 };
          }
          inventory.availableQty -= data.availableQty.decrement;
          inventory.reservedQty += data.reservedQty.increment;
          inventory.version += data.version.increment;
          return { count: 1 };
        }
      },
      order: {
        async create({ data }: any) {
          const id = `order-${state.orders.size + 1}`;
          const order = {
            id,
            customerId: data.customerId,
            idempotencyKey: data.idempotencyKey,
            status: data.status,
            totalCents: data.totalCents,
            currency: data.currency,
            items: data.items.create
          };
          state.orders.set(id, order);
          return order;
        }
      },
      outboxEvent: {
        async create({ data }: any) {
          state.outbox.push(data);
          return data;
        }
      }
    });

    return {
      state,
      prisma: {
        $transaction: async (...args: Parameters<typeof txFactory>) => {
          state.transactionCalls += 1;
          return txFactory(...args);
        },
        idempotencyKey: {
          findUnique: async ({ where }: any) => {
            const key = `${where.customerId_key.customerId}:${where.customerId_key.key}`;
            return state.idempotencyByKey.get(key) ?? null;
          }
        },
        order: {
          findUnique: async ({ where }: any) => state.orders.get(where.id) ?? null
        }
      }
    };
  }

  it('accepts checkout once and returns the same response for the same idempotency key', async () => {
    const { prisma, state } = createPrismaStub();
    const productsService = {
      invalidateAvailability: jest.fn().mockResolvedValue(undefined)
    };
    const service = new CheckoutService(prisma as any, productsService as any);
    const controller = new CheckoutController(service);
    const response = { status: jest.fn() } as any;

    const first = await controller.checkout(
      'customer-1',
      'idem-1',
      { items: [{ productId: 'prod-1', quantity: 1 }] },
      response
    );

    const second = await controller.checkout(
      'customer-1',
      'idem-1',
      { items: [{ productId: 'prod-1', quantity: 1 }] },
      response
    );

    expect(first).toMatchObject({
      orderId: 'order-1',
      status: 'PENDING_ERP',
      totalCents: 5990,
      currency: 'BRL'
    });
    expect(response.status).toHaveBeenCalledWith(200);
    expect(second).toEqual(first);
    expect(state.orders.size).toBe(1);
    expect(productsService.invalidateAvailability).toHaveBeenCalledWith(['prod-1']);
  });

  it('prevents overselling under concurrent checkout', async () => {
    const { prisma } = createPrismaStub();
    const productsService = {
      invalidateAvailability: jest.fn().mockResolvedValue(undefined)
    };
    const service = new CheckoutService(prisma as any, productsService as any);

    const attempts = await Promise.allSettled(
      Array.from({ length: 20 }, (_, index) =>
        service.checkout(`customer-${index}`, `idem-${index}`, {
          items: [{ productId: 'prod-hot', quantity: 1 }]
        })
      )
    );

    const accepted = attempts.filter(
      (result): result is PromiseFulfilledResult<any> =>
        result.status === 'fulfilled' && result.value.httpStatus === 202
    );

    expect(accepted).toHaveLength(1);
  });

  it('rejects payload changes for the same idempotency key', async () => {
    const { prisma } = createPrismaStub();
    const productsService = {
      invalidateAvailability: jest.fn().mockResolvedValue(undefined)
    };
    const service = new CheckoutService(prisma as any, productsService as any);

    await service.checkout('customer-1', 'idem-1', {
      items: [{ productId: 'prod-1', quantity: 1 }]
    });

    await expect(
      service.checkout('customer-1', 'idem-1', {
        items: [{ productId: 'prod-1', quantity: 2 }]
      })
    ).rejects.toThrow('Idempotency key reused with different payload');
  });

  it('retries transient inventory write conflicts and still accepts the checkout', async () => {
    const { prisma, state } = createPrismaStub({ inventoryUpdateFailures: 1 });
    const productsService = {
      invalidateAvailability: jest.fn().mockResolvedValue(undefined)
    };
    const service = new CheckoutService(prisma as any, productsService as any);

    const result = await service.checkout('customer-1', 'idem-1', {
      items: [{ productId: 'prod-1', quantity: 1 }]
    });

    expect(result.httpStatus).toBe(202);
    expect(state.transactionCalls).toBeGreaterThan(1);
    expect(state.orders.size).toBe(1);
  });

  it('acquires advisory locks in a stable order before mutating inventory', async () => {
    const { prisma, state } = createPrismaStub({ captureLocks: true });
    const productsService = {
      invalidateAvailability: jest.fn().mockResolvedValue(undefined)
    };
    const service = new CheckoutService(prisma as any, productsService as any);

    const result = await service.checkout('customer-1', 'idem-1', {
      items: [
        { productId: 'prod-hot', quantity: 1 },
        { productId: 'prod-1', quantity: 1 }
      ]
    });

    expect(result.httpStatus).toBe(202);
    expect(state.locks).toEqual([
      'customer-1:idem-1',
      'inventory:prod-1',
      'inventory:prod-hot'
    ]);
  });
});
