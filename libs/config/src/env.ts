export const env = {
  apiPort: Number(process.env.API_PORT ?? 3000),
  erpPort: Number(process.env.ERP_PORT ?? 3001),
  databaseUrl:
    process.env.DATABASE_URL ??
    'postgresql://casecellshop:casecellshop@localhost:5432/casecellshop',
  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
  rabbitmqUrl: process.env.RABBITMQ_URL ?? 'amqp://guest:guest@localhost:5672',
  erpBaseUrl: process.env.ERP_BASE_URL ?? 'http://localhost:3001',
  logLevel: process.env.LOG_LEVEL ?? 'info',
  workerHeartbeatMs: Number(process.env.WORKER_HEARTBEAT_MS ?? 30000)
};
