import { Injectable, OnModuleDestroy, Optional } from '@nestjs/common';
import Redis from 'ioredis';
import { env } from '../../config/src';
import { MetricsService } from '../../observability/src';

@Injectable()
export class CacheService implements OnModuleDestroy {
  private readonly redis = new Redis(env.redisUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: 1
  });

  constructor(@Optional() private readonly metricsService?: MetricsService) {}

  async onModuleDestroy() {
    if (this.redis.status !== 'end') {
      await this.redis.quit();
    }
  }

  async getJson<T>(key: string): Promise<T | null> {
    await this.ensureConnected();
    const value = await this.redis.get(key);

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

    await this.ensureConnected();
    const values = await this.redis.mget(keys);

    return values.map((value, index) => {
      this.metricsService?.[value ? 'recordCacheHit' : 'recordCacheMiss'](
        this.getCacheNamespace(keys[index])
      );

      return value ? (JSON.parse(value) as T) : null;
    });
  }

  async setJson(key: string, value: unknown, ttlSeconds: number) {
    await this.ensureConnected();
    await this.redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
  }

  async delete(key: string) {
    await this.ensureConnected();
    await this.redis.del(key);
  }

  async acquireLock(key: string, ttlSeconds: number) {
    await this.ensureConnected();
    const result = await this.redis.set(key, '1', 'EX', ttlSeconds, 'NX');

    return result === 'OK';
  }

  async releaseLock(key: string) {
    await this.ensureConnected();
    await this.redis.del(key);
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
