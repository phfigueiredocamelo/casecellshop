import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { env } from '../../config/src';

@Injectable()
export class CacheService implements OnModuleDestroy {
  private readonly redis = new Redis(env.redisUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: 1
  });

  async onModuleDestroy() {
    if (this.redis.status !== 'end') {
      await this.redis.quit();
    }
  }

  async getJson<T>(key: string): Promise<T | null> {
    await this.ensureConnected();
    const value = await this.redis.get(key);

    return value ? (JSON.parse(value) as T) : null;
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
}
