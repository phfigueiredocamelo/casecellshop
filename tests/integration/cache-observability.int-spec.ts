import { CacheService } from '../../libs/cache/src/cache.service';
import { LoggerService } from '../../libs/observability/src/logger.service';
import { MetricsService } from '../../libs/observability/src/metrics.service';
import { RequestContextService } from '../../libs/observability/src/request-context.service';
import { TraceService } from '../../libs/observability/src/trace.service';

describe('CacheService observability', () => {
  it('records redis duration metrics and cache hit/miss counters', async () => {
    const requestContext = new RequestContextService();
    const logger = new LoggerService(requestContext);
    const trace = new TraceService(requestContext, logger);
    const metrics = new MetricsService();
    const traceSpy = jest.spyOn(trace, 'startSpan').mockImplementation(async (_op, callback) => callback());
    const cache = new CacheService(metrics, trace);

    (cache as any).redis = {
      status: 'ready',
      get: jest
        .fn()
        .mockResolvedValueOnce(JSON.stringify({ value: 1 }))
        .mockResolvedValueOnce(null),
      mget: jest.fn().mockResolvedValue(['1', null]),
      set: jest.fn().mockResolvedValue('OK'),
      del: jest.fn().mockResolvedValue(1),
      connect: jest.fn(),
      quit: jest.fn()
    };

    const hit = await cache.getJson<{ value: number }>('products:query:v1:brand=all');
    const miss = await cache.getJson<{ value: number }>('other:query:v1:brand=all');
    await cache.getJsonMany<string>(['products:query:v1:brand=all', 'products:query:v1:brand=all:2']);
    await cache.setJson('product:card:v1:prod-1', { id: 'prod-1' }, 300);
    await cache.delete('product:card:v1:prod-1');

    expect(hit).toEqual({ value: 1 });
    expect(miss).toBeNull();
    expect(traceSpy).toHaveBeenCalledWith('cache.get', expect.any(Function));
    expect(traceSpy).toHaveBeenCalledWith('cache.mget', expect.any(Function));
    expect(traceSpy).toHaveBeenCalledWith('cache.set', expect.any(Function));
    expect(traceSpy).toHaveBeenCalledWith('cache.del', expect.any(Function));

    const output = await metrics.getMetrics();
    expect(output).toContain('redis_operation_duration_seconds');
    expect(output).toContain('cache_hits_total{cache="products"} 2');
    expect(output).toContain('cache_misses_total{cache="other"} 1');
  });
});
