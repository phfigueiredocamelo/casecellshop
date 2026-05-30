import { Test } from '@nestjs/testing';
import { AppModule } from '../../apps/api/src/app.module';
import { configureOpenApi } from '../../apps/api/src/main';
import { CacheService } from '../../libs/cache/src/cache.service';
import { PrismaService } from '../../libs/db/src/prisma.service';

describe('OpenAPI contract', () => {
  it('exposes /openapi.json and documents success and error schemas', async () => {
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
        getJsonMany: jest.fn().mockResolvedValue([]),
        setJson: jest.fn().mockResolvedValue(undefined),
        delete: jest.fn().mockResolvedValue(undefined),
        acquireLock: jest.fn().mockResolvedValue(true),
        releaseLock: jest.fn().mockResolvedValue(undefined)
      })
      .compile();

    const app = moduleRef.createNestApplication({ logger: false });
    const document = configureOpenApi(app);

    await app.init();

    const expressApp = app.getHttpAdapter().getInstance();
    const router = expressApp?._router ?? expressApp?.router;
    const hasOpenApiRoute = router?.stack?.some((layer: { route?: { path?: string } }) =>
      layer.route?.path === '/openapi.json'
    );
    const checkoutPost = document.paths?.['/checkout']?.post;

    expect(hasOpenApiRoute).toBe(true);
    expect(checkoutPost?.responses['202']).toBeDefined();
    expect(checkoutPost?.responses['400']).toBeDefined();
    expect(checkoutPost?.responses['409']).toBeDefined();
    expect(checkoutPost?.responses['422']).toBeDefined();
    expect(document.components?.schemas?.ApiErrorDto).toBeDefined();

    await app.close();
  });
});
