import { buildLargeCatalog } from './catalog-data';

async function main() {
  const size = Number(process.env.SEED_SIZE ?? 10000);
  const response = await fetch(
    `${process.env.ERP_BASE_URL ?? 'http://localhost:3001'}/erp/catalog`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        products: buildLargeCatalog(size)
      })
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to seed large catalog: ${response.status} ${response.statusText}`);
  }

  const payload = (await response.json()) as { count: number };
  console.log(`Seeded large catalog with ${payload.count} products`);
}

void main();
