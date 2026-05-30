import { Injectable, OnModuleDestroy, Optional } from '@nestjs/common';
import Redis from 'ioredis';
import { env } from '../../config/src';
import { MetricsService } from '../../observability/src';
import { TraceService } from '../../observability/src';

@Injectable()
export class CacheService implements OnModuleDestroy {
  private readonly redis = new Redis(env.redisUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: 1
  });

  constructor(
    @Optional() private readonly metricsService?: MetricsService,
    @Optional() private readonly traceService?: TraceService
  ) {}

  async onModuleDestroy() {
    if (this.redis.status !== 'end') {
      await this.redis.quit();
    }
  }

  async getJson<T>(key: string): Promise<T | null> {
    const value = await this.observeRedis('get', async () => {
      await this.ensureConnected();

      return this.redis.get(key);
    });

    if (!value) {
      this.metricsService?.recordCacheMiss(this.getCacheNamespace(key));

      return null;
    }

    this.metricsService?.recordCacheHit(this.getCacheNamespace(key));

    return JSON.parse(value) as T;
  }

  async getJsonMany<T>(keys: string[]): Promise<Array<T | null>> {
    if (keys.length === 0) {
      return [];
    }

    const values = await this.observeRedis('mget', async () => {
      await this.ensureConnected();

      return this.redis.mget(keys);
    });

    return values.map((value, index) => {
      this.metricsService?.[value ? 'recordCacheHit' : 'recordCacheMiss'](
        this.getCacheNamespace(keys[index])
      );

      return value ? (JSON.parse(value) as T) : null;
    });
  }

  async setJson(key: string, value: unknown, ttlSeconds: number) {
    await this.observeRedis('set', async () => {
      await this.ensureConnected();

      return this.redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
    });
  }

  async delete(key: string) {
    await this.observeRedis('del', async () => {
      await this.ensureConnected();

      return this.redis.del(key);
    });
  }

  async acquireLock(key: string, ttlSeconds: number) {
    const result = await this.observeRedis('lock', async () => {
      await this.ensureConnected();

      return this.redis.set(key, '1', 'EX', ttlSeconds, 'NX');
    });

    return result === 'OK';
  }

  async releaseLock(key: string) {
    await this.observeRedis('unlock', async () => {
      await this.ensureConnected();

      return this.redis.del(key);
    });
  }

  private async observeRedis<T>(operation: string, callback: () => Promise<T>): Promise<T> {
    const startedAt = process.hrtime.bigint();

    try {
      const result = this.traceService
        ? await this.traceService.startSpan(`cache.${operation}`, callback)
        : await callback();

      this.metricsService?.recordRedisOperation({
        operation,
        outcome: this.getRedisOutcome(operation, result),
        durationSeconds: Number(process.hrtime.bigint() - startedAt) / 1_000_000_000
      });

      return result;
    } catch (error) {
      this.metricsService?.recordRedisOperation({
        operation,
        outcome: 'error',
        durationSeconds: Number(process.hrtime.bigint() - startedAt) / 1_000_000_000
      });

      throw error;
    }
  }

  private getRedisOutcome<T>(operation: string, result: T) {
    if (operation === 'get') {
      return result ? 'hit' : 'miss';
    }

    return 'ok';
  }

  private async ensureConnected() {
    if (this.redis.status === 'wait') {
      await this.redis.connect();
    }
  }

  private getCacheNamespace(key: string) {
    return key.split(':')[0] || 'unknown';
  }
}
