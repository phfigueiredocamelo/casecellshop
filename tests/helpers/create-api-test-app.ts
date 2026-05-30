import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../apps/api/src/app.module';
import { CacheService } from '../../libs/cache/src';
import { PrismaService } from '../../libs/db/src';

export async function createApiTestApp(): Promise<INestApplication> {
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

  await app.init();

  return app;
}
