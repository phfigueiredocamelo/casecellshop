export interface FakeErpHarness {
  setCatalog(catalog: unknown[]): Promise<void>;
  enableBillingFailure(orderId: string): void;
}

export interface CacheHarness {
  put(key: string, value: unknown): Promise<void>;
  get(key: string): Promise<unknown | null>;
}

export interface RabbitHarness {
  wasRoutedToDlq(orderId: string): Promise<boolean>;
}

export interface OrderFixtures {
  createPendingOrder(input: { id: string }): Promise<void>;
}

export interface CheckoutHarness {
  purchaseOne(productId: string): Promise<void>;
}

export interface IntegrationHarness {
  fakeErpHarness: FakeErpHarness;
  cacheHarness: CacheHarness;
  rabbitHarness: RabbitHarness;
  orderFixtures: OrderFixtures;
  checkoutHarness: CheckoutHarness;
}

export function createIntegrationHarness(): IntegrationHarness {
  return {
    fakeErpHarness: {
      async setCatalog(_catalog: unknown[]) {},
      enableBillingFailure(_orderId: string) {}
    },
    cacheHarness: {
      async put(_key: string, _value: unknown) {},
      async get(_key: string) {
        return null;
      }
    },
    rabbitHarness: {
      async wasRoutedToDlq(_orderId: string) {
        return false;
      }
    },
    orderFixtures: {
      async createPendingOrder(_input: { id: string }) {}
    },
    checkoutHarness: {
      async purchaseOne(_productId: string) {}
    }
  };
}
