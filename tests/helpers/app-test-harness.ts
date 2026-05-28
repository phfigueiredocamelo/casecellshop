export function createIntegrationHarness() {
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
