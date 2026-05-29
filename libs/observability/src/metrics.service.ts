import { Injectable } from '@nestjs/common';
import { Counter, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

@Injectable()
export class MetricsService {
  readonly registry = new Registry();
  readonly httpRequestDurationSeconds = new Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP request latency in seconds',
    labelNames: ['route', 'method', 'status'],
    registers: [this.registry]
  });
  readonly cacheHitsTotal = new Counter({
    name: 'cache_hits_total',
    help: 'Count of cache hits',
    labelNames: ['cache'],
    registers: [this.registry]
  });
  readonly cacheMissesTotal = new Counter({
    name: 'cache_misses_total',
    help: 'Count of cache misses',
    labelNames: ['cache'],
    registers: [this.registry]
  });

  constructor() {
    collectDefaultMetrics({ register: this.registry });
  }

  recordHttpRequest(input: {
    route: string;
    method: string;
    status: number;
    durationSeconds: number;
  }) {
    this.httpRequestDurationSeconds
      .labels(input.route, input.method, String(input.status))
      .observe(input.durationSeconds);
  }

  recordCacheHit(cache: string) {
    this.cacheHitsTotal.labels(cache).inc();
  }

  recordCacheMiss(cache: string) {
    this.cacheMissesTotal.labels(cache).inc();
  }

  async getMetrics() {
    return this.registry.metrics();
  }
}
