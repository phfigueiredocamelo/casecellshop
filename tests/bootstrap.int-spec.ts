import { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { AppModule as ApiAppModule } from '../apps/api/src/app.module';
import { HealthController as ApiHealthController } from '../apps/api/src/health.controller';
import { CacheService } from '../libs/cache/src/cache.service';
import { AppModule as FakeErpAppModule } from '../apps/fake-erp/src/app.module';
import { HealthController as FakeErpHealthController } from '../apps/fake-erp/src/health.controller';
import { PrismaService } from '../libs/db/src/prisma.service';
import { AppModule as OrderWorkerAppModule } from '../apps/order-worker/src/app.module';
import { WorkerRunnerService as OrderWorkerRunnerService } from '../apps/order-worker/src/worker-runner.service';
import { ErpCatalogClient } from '../apps/reconciliation-worker/src/erp-catalog.client';
import { ReconciliationRunner } from '../apps/reconciliation-worker/src/reconciliation.runner';
import { AppModule as OutboxWorkerAppModule } from '../apps/outbox-worker/src/app.module';
import { WorkerRunnerService as OutboxWorkerRunnerService } from '../apps/outbox-worker/src/worker-runner.service';
import { WorkerRunnerService as ReconciliationWorkerRunnerService } from '../apps/reconciliation-worker/src/worker-runner.service';

describe('bootstrap', () => {
  let apps: INestApplication[] = [];

  afterEach(async () => {
    await Promise.all(apps.map((app) => app.close()));
    apps = [];
  });

  it('boots the API app with a health endpoint', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ApiAppModule]
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
    apps.push(app);

    expect(app.get(ApiHealthController).getHealth()).toEqual({
      service: 'api',
      status: 'ok'
    });
  });

  it('boots the fake ERP app with a health endpoint', async () => {
    const app = await NestFactory.create(FakeErpAppModule, { logger: false });

    await app.init();
    apps.push(app);

    expect(app.get(FakeErpHealthController).getHealth()).toEqual({
      service: 'fake-erp',
      status: 'ok'
    });
  });

  it('keeps the outbox worker alive after bootstrap', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [OutboxWorkerAppModule]
    })
      .overrideProvider(PrismaService)
      .useValue({
        $connect: jest.fn(),
        $disconnect: jest.fn(),
        outboxEvent: {
          findMany: jest.fn(),
          update: jest.fn()
        }
      })
      .compile();

    await moduleRef.init();
    const runner = moduleRef.get(OutboxWorkerRunnerService);

    expect(runner.isRunning()).toBe(true);

    await moduleRef.close();
  });

  it('keeps the order worker alive after bootstrap', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [OrderWorkerAppModule]
    })
      .overrideProvider(PrismaService)
      .useValue({
        $connect: jest.fn(),
        $disconnect: jest.fn()
      })
      .compile();

    await moduleRef.init();
    const runner = moduleRef.get(OrderWorkerRunnerService);

    expect(runner.isRunning()).toBe(true);

    await moduleRef.close();
  });

  it('keeps the reconciliation worker alive after bootstrap', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        ReconciliationWorkerRunnerService,
        ReconciliationRunner,
        ErpCatalogClient,
        {
          provide: PrismaService,
          useValue: {
            $transaction: jest.fn(),
            product: {
              updateMany: jest.fn()
            },
            catalogVersion: {
              upsert: jest.fn().mockResolvedValue({
                key: 'catalog',
                version: 1
              })
            }
          }
        },
        {
          provide: CacheService,
          useValue: {
            delete: jest.fn().mockResolvedValue(undefined)
          }
        }
      ]
    }).compile();
    await moduleRef.init();
    const runner = moduleRef.get(ReconciliationWorkerRunnerService);

    expect(runner.isRunning()).toBe(true);

    await moduleRef.close();
  });
});
