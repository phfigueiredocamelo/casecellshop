import { Test } from '@nestjs/testing';
import { lastValueFrom, of } from 'rxjs';
import { AppModule } from '../../apps/api/src/app.module';
import { HealthController } from '../../apps/api/src/health.controller';
import { HttpMetricsInterceptor } from '../../libs/observability/src/http-metrics.interceptor';
import { MetricsService } from '../../libs/observability/src/metrics.service';
import { ProductsService } from '../../apps/api/src/products/products.service';
import { CacheService } from '../../libs/cache/src/cache.service';
import { PrismaService } from '../../libs/db/src/prisma.service';
import { MetricsController } from '../../libs/observability/src/metrics.controller';

describe('api observability foundation', () => {
  it('exposes health and metrics endpoints through the app graph', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule]
    })
      .overrideProvider(PrismaService)
      .useValue({
        catalogVersion: {
          findUnique: jest.fn().mockResolvedValue({ key: 'catalog', version: 1 })
        },
        product: {
          findMany: jest.fn().mockResolvedValue([])
        }
      })
      .overrideProvider(CacheService)
      .useValue({
        getJson: jest.fn().mockResolvedValue(null),
        setJson: jest.fn().mockResolvedValue(undefined),
        acquireLock: jest.fn().mockResolvedValue(true),
        releaseLock: jest.fn().mockResolvedValue(undefined)
      })
      .compile();
    const app = moduleRef.createNestApplication({ logger: false });

    await app.init();

    expect(app.get(HealthController).getHealth()).toEqual({
      service: 'api',
      status: 'ok'
    });

    await lastValueFrom(
      app.get(HttpMetricsInterceptor).intercept(
        {
          getType: () => 'http',
          switchToHttp: () => ({
            getRequest: () => ({
              method: 'GET',
              originalUrl: '/health',
              route: { path: '/health' }
            }),
            getResponse: () => ({ statusCode: 200 })
          })
        } as any,
        { handle: () => of({ status: 'ok' }) } as any
      )
    );

    const metricsResponse = await app.get(MetricsController).getMetrics();

    expect(metricsResponse).toContain('http_request_duration_seconds');
    expect(metricsResponse).toContain('route="/health",method="GET",status="200"');
    expect(metricsResponse).toContain('cache_hits_total');

    app.get(MetricsService).recordCacheHit('products');
    app.get(MetricsService).recordProductCardHydrationMiss(2);
    const updatedMetricsResponse = await app.get(MetricsController).getMetrics();
    expect(updatedMetricsResponse).toContain('cache_hits_total{cache="products"} 1');
    expect(updatedMetricsResponse).toContain('product_card_hydration_misses_total 2');

    await app.close();
  });

  it('builds a canonical cache key for product queries', () => {
    const service = new ProductsService({} as any, {} as any);

    expect(
      service.buildProductsQueryCacheKey(42, {
        brand: 'apple',
        device: 'apple-iphone-15',
        sort: 'price_asc',
        page: 1,
        pageSize: 24
      })
    ).toBe(
      'products:query:v42:brand=apple:device=apple-iphone-15:sort=price_asc:page=1:size=24'
    );
  });

  it('returns only products compatible with the requested device', async () => {
    const findMany = jest.fn().mockResolvedValue([
      {
        id: 'prod-1',
        sku: 'SKU-1',
        name: 'Capa iPhone 15',
        imageUrl: null,
        brand: 'CaseCell',
        price: { priceCents: 5990, currency: 'BRL' },
        inventory: { availableQty: 7 }
      }
    ]);
    const service = new ProductsService(
      {
        catalogVersion: {
          findUnique: jest.fn().mockResolvedValue({ key: 'catalog', version: 7 })
        },
        product: {
          findMany
        }
      } as any,
      {
        getJson: jest.fn().mockResolvedValue(null),
        setJson: jest.fn().mockResolvedValue(undefined),
        acquireLock: jest.fn().mockResolvedValue(true),
        releaseLock: jest.fn().mockResolvedValue(undefined)
      } as any
    );

    const response = await service.listProducts({
      device: 'apple-iphone-15'
    });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          active: true,
          compatibilities: {
            some: {
              deviceModel: {
                slug: 'apple-iphone-15'
              }
            }
          }
        })
      })
    );
    expect(response.items).toEqual([
      expect.objectContaining({
        id: 'prod-1',
        priceCents: 5990,
        availableQty: 7,
        inStock: true
      })
    ]);
  });

  it('hydrates cached product ids with a single batched product lookup', async () => {
    const findMany = jest.fn().mockResolvedValue([
      {
        id: 'prod-2',
        sku: 'SKU-2',
        name: 'Capa Galaxy S24',
        imageUrl: null,
        brand: 'CaseCell',
        price: { priceCents: 6990, currency: 'BRL' },
        inventory: { availableQty: 3 }
      },
      {
        id: 'prod-1',
        sku: 'SKU-1',
        name: 'Capa iPhone 15',
        imageUrl: null,
        brand: 'CaseCell',
        price: { priceCents: 5990, currency: 'BRL' },
        inventory: { availableQty: 7 }
      }
    ]);
    const getJson = jest
      .fn()
      .mockResolvedValueOnce(['prod-1', 'prod-2'])
      .mockResolvedValue(null);
    const getJsonMany = jest.fn().mockResolvedValue([null, null]);
    const service = new ProductsService(
      {
        catalogVersion: {
          findUnique: jest.fn().mockResolvedValue({ key: 'catalog', version: 11 })
        },
        product: {
          findMany
        }
      } as any,
      {
        getJson,
        getJsonMany,
        setJson: jest.fn().mockResolvedValue(undefined),
        acquireLock: jest.fn().mockResolvedValue(true),
        releaseLock: jest.fn().mockResolvedValue(undefined)
      } as any
    );

    const response = await service.listProducts({
      device: 'apple-iphone-15'
    });

    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          active: true,
          id: { in: ['prod-1', 'prod-2'] }
        }),
        take: 2
      })
    );
    expect(response.items.map((item) => item.id)).toEqual(['prod-1', 'prod-2']);
  });

  it('returns partial hydrated products when another worker owns the missing card refill', async () => {
    const cachedProduct = {
      id: 'prod-1',
      sku: 'SKU-1',
      name: 'Capa iPhone 15',
      imageUrl: null,
      brand: 'CaseCell',
      priceCents: 5990,
      currency: 'BRL',
      availableQty: 7,
      inStock: true
    };
    const findMany = jest.fn();
    const recordProductCardHydrationMiss = jest.fn();
    const getJson = jest.fn().mockResolvedValue(['prod-1', 'prod-2']);
    const getJsonMany = jest
      .fn()
      .mockResolvedValueOnce([cachedProduct, null])
      .mockResolvedValueOnce([null]);
    const acquireLock = jest.fn().mockResolvedValue(false);
    const service = new ProductsService(
      {
        catalogVersion: {
          findUnique: jest.fn().mockResolvedValue({ key: 'catalog', version: 13 })
        },
        product: {
          findMany
        }
      } as any,
      {
        getJson,
        getJsonMany,
        setJson: jest.fn().mockResolvedValue(undefined),
        acquireLock,
        releaseLock: jest.fn().mockResolvedValue(undefined)
      } as any,
      {
        recordProductCardHydrationMiss
      } as any
    );

    const response = await service.listProducts({
      device: 'apple-iphone-15'
    });

    expect(findMany).not.toHaveBeenCalled();
    expect(acquireLock).toHaveBeenCalledWith(
      expect.stringMatching(/^lock:product:hydrate:v13:[a-f0-9]{16}$/),
      5
    );
    expect(response.items).toEqual([cachedProduct]);
    expect(response.meta).toEqual(
      expect.objectContaining({
        cache: 'hit',
        degraded: true,
        missingProductCardIds: ['prod-2'],
        missingProductCards: 1
      })
    );
    expect(recordProductCardHydrationMiss).toHaveBeenCalledWith(1);
  });

  it('waits briefly for a query lock and returns empty when contention persists', async () => {
    const findMany = jest.fn();
    const acquireLock = jest.fn().mockResolvedValue(false);
    const setTimeoutSpy = jest.spyOn(global, 'setTimeout').mockImplementation((callback: any) => {
      if (typeof callback === 'function') {
        callback();
      }

      return 0 as any;
    });
    const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0);
    const service = new ProductsService(
      {
        catalogVersion: {
          findUnique: jest.fn().mockResolvedValue({ key: 'catalog', version: 15 })
        },
        product: {
          findMany
        }
      } as any,
      {
        getJson: jest.fn().mockResolvedValue(null),
        setJson: jest.fn().mockResolvedValue(undefined),
        acquireLock,
        releaseLock: jest.fn().mockResolvedValue(undefined)
      } as any
    );

    try {
      const response = await service.listProducts({
        device: 'apple-iphone-15'
      });

      expect(acquireLock).toHaveBeenCalledTimes(2);
      expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 25);
      expect(findMany).not.toHaveBeenCalled();
      expect(response.items).toEqual([]);
      expect(response.meta).toEqual(
        expect.objectContaining({
          cache: 'miss-locked',
          retryLater: true
        })
      );
    } finally {
      setTimeoutSpy.mockRestore();
      randomSpy.mockRestore();
    }
  });

  it('warms product card caches when populating a product query cache miss', async () => {
    const setJson = jest.fn().mockResolvedValue(undefined);
    const service = new ProductsService(
      {
        catalogVersion: {
          findUnique: jest.fn().mockResolvedValue({ key: 'catalog', version: 12 })
        },
        product: {
          findMany: jest.fn().mockResolvedValue([
            {
              id: 'prod-1',
              sku: 'SKU-1',
              name: 'Capa iPhone 15',
              imageUrl: null,
              brand: 'CaseCell',
              price: { priceCents: 5990, currency: 'BRL' },
              inventory: { availableQty: 7 }
            }
          ])
        }
      } as any,
      {
        getJson: jest.fn().mockResolvedValue(null),
        setJson,
        acquireLock: jest.fn().mockResolvedValue(true),
        releaseLock: jest.fn().mockResolvedValue(undefined)
      } as any
    );

    await service.listProducts({
      device: 'apple-iphone-15'
    });

    expect(setJson).toHaveBeenCalledWith(
      'products:query:v12:brand=all:device=apple-iphone-15:sort=relevance:page=1:size=24',
      ['prod-1'],
      90
    );
    expect(setJson).toHaveBeenCalledWith(
      'product:card:v12:prod-1',
      expect.objectContaining({
        id: 'prod-1',
        priceCents: 5990,
        availableQty: 7
      }),
      300
    );
  });

  it('invalidates only product availability and card caches for affected products', async () => {
    const deleteSpy = jest.fn().mockResolvedValue(undefined);
    const service = new ProductsService(
      {
        catalogVersion: {
          findUnique: jest.fn().mockResolvedValue({ key: 'catalog', version: 9 })
        }
      } as any,
      {
        delete: deleteSpy
      } as any
    );

    await service.invalidateAvailability(['prod-1', 'prod-2']);

    expect(deleteSpy).toHaveBeenCalledWith('product:card:v9:prod-1');
    expect(deleteSpy).toHaveBeenCalledWith('product:card:v9:prod-2');
  });
});
