import { Test } from '@nestjs/testing';
import { AppModule } from '../../apps/api/src/app.module';
import { HealthController } from '../../apps/api/src/health.controller';
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

    const metricsResponse = await app.get(MetricsController).getMetrics();
    expect(metricsResponse).toContain('http_request_duration_seconds');
    expect(metricsResponse).toContain('cache_hits_total');

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

    expect(deleteSpy).toHaveBeenCalledWith('product:availability:prod-1');
    expect(deleteSpy).toHaveBeenCalledWith('product:card:v9:prod-1');
    expect(deleteSpy).toHaveBeenCalledWith('product:availability:prod-2');
    expect(deleteSpy).toHaveBeenCalledWith('product:card:v9:prod-2');
  });
});
