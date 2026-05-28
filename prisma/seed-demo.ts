import { buildDemoCatalog } from './catalog-data';

async function main() {
  const response = await fetch(
    `${process.env.ERP_BASE_URL ?? 'http://localhost:3001'}/erp/catalog`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        products: buildDemoCatalog()
      })
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to seed demo catalog: ${response.status} ${response.statusText}`);
  }

  const payload = (await response.json()) as { count: number };
  console.log(`Seeded demo catalog with ${payload.count} products`);
}

void main();
