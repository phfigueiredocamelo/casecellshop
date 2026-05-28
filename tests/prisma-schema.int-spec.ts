import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaService } from '../libs/db/src/prisma.service';

describe('prisma foundation', () => {
  it('declares the expected models in the Prisma schema', () => {
    const schema = readFileSync(join(process.cwd(), 'prisma/schema.prisma'), 'utf8');

    for (const modelName of [
      'CatalogVersion',
      'DeviceModel',
      'ErpSnapshot',
      'IdempotencyKey',
      'IntegrationAttempt',
      'Inventory',
      'Order',
      'OrderItem',
      'OutboxEvent',
      'Product',
      'ProductCompatibility',
      'ProductPrice',
      'ProductStats'
    ]) {
      expect(schema).toContain(`model ${modelName} {`);
    }
  });

  it('exports a Prisma service class for Nest modules', () => {
    expect(typeof PrismaService).toBe('function');
  });
});
