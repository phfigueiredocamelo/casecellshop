# casecellshop

CaseCellShop is a backend demo for an e-commerce flow with catalog sync, checkout idempotency, queue-based billing, and reconciliation workers.

## Quick Start

1. Prepare the local stack:

```bash
cp .env.example .env
docker compose up -d postgres redis rabbitmq
npm install
npm run build
npm run prisma:generate
DATABASE_URL=postgresql://casecellshop:casecellshop@localhost:5432/casecellshop XDG_CACHE_HOME=.cache ./node_modules/.bin/prisma db push --accept-data-loss --force-reset
npm run start:stack
```

2. Seed the fake ERP and sync the catalog:

```bash
npm run seed:demo
curl -X POST http://localhost:3000/admin/sync/erp
```

3. Check the services:

- API: `GET http://localhost:3000/health`
- fake ERP: `GET http://localhost:3001/health`
- workers: long-lived Nest application contexts with heartbeat logs

## Manual API testing

Use `rest-client.http` with the VS Code REST Client extension, or copy the requests to curl/Postman.

Suggested flow:

1. Check `GET /health` on the API and fake ERP.
2. List products with `GET /products`, then fetch one product with `GET /products/:id`.
3. Create an order with `POST /checkout`, always sending `X-Customer-Id` and `Idempotency-Key`.
4. Repeat the same checkout request with the same idempotency key. The first response should be `202`; the replay should return the same body with `200`.
5. Repeat the same idempotency key with a different quantity. The API should reject it with `409`.
6. Fetch the order with `GET /orders/:id` or inspect the idempotency entry with `GET /orders/by-idempotency-key/:key`.

Useful demo product ids after `seed:demo` and `POST /admin/sync/erp`:

- `prod_case_iphone_15_clear`
- `prod_case_iphone_15_pro_black`
- `prod_case_galaxy_s24_blue`
- `prod_case_multifit_magsafe`

## Manual queue testing

RabbitMQ runs on `localhost:5672`; the management UI is available at `http://localhost:15672` with user `casecellshop` and password `casecellshop`.

The queue topology is:

- exchange: `orders`
- main queue: `orders.billing.q`
- retry queue: `orders.billing.retry.q`
- dead-letter queue: `orders.billing.dlq`
- routing key from exchange to main queue: `billing`

The workers now run the billing flow automatically:

- `start:outbox-worker` publishes pending `OutboxEvent` rows to RabbitMQ.
- `start:order-worker` consumes `orders.billing.q`, calls the fake ERP, and updates the order status.

To verify RabbitMQ itself:

1. Open the management UI and confirm the `orders` exchange and the `orders.billing.*` queues exist.
2. Run a successful `POST /checkout`.
3. Watch `orders.billing.q` receive the outbox message.
4. Open the queue message, inspect the headers/payload, and purge it if needed.

To verify the application outbox side:

1. Run a successful `POST /checkout`.
2. Confirm the order was created and the outbox event moves through `PENDING` to `PUBLISHED`:

```bash
docker compose exec postgres psql -U casecellshop -d casecellshop -c 'select id, "aggregateId", "eventType", status, attempts from "OutboxEvent" order by "createdAt" desc limit 5;'
```

The integration suite `tests/integration/workers.int-spec.ts` covers the publisher, consumer, and worker bootstrap wiring.

## Run tests

```bash
npm test
```

## Load Testing

Prepare the local stack and demo catalog:

```bash
cp .env.example .env
docker compose up -d postgres redis rabbitmq
npm install
npm run build
npm run prisma:generate
DATABASE_URL=postgresql://casecellshop:casecellshop@localhost:5432/casecellshop XDG_CACHE_HOME=.cache ./node_modules/.bin/prisma db push --accept-data-loss --force-reset
npm run start:stack
npm run seed:demo
curl -X POST http://localhost:3000/admin/sync/erp
```

`seed:demo` and `seed:large` load the fake ERP in memory. Use `seed:demo` for a quick smoke run and `seed:large` for the heavier catalog scenarios. The API reads catalog data from Postgres, so run `POST /admin/sync/erp` after seeding. The local database is created directly from `prisma/schema.prisma` with `prisma db push --force-reset` because this repo does not ship migrations yet.

Run the local scenarios:

```bash
npm run k6:smoke
npm run k6:products
npm run k6:products-cache
npm run k6:checkout
npm run k6:idempotency
```

Scenarios:

- `k6:smoke`: quick health, product list, and known demo product checks.
- `k6:products`: moderate catalog list load with device and sort variants.
- `k6:products-cache`: repeated catalog and product reads to exercise warm paths.
- `k6:checkout`: concurrent checkout pressure against demo stock.
- `k6:idempotency`: replay and divergent-payload idempotency checks.

The checkout flow retries transient Prisma `P2034` write conflicts, so the concurrent checkout scenario should stay within `202`, `409`, and `422` instead of surfacing `500`s.

The Docker container reaches the host API through `http://host.docker.internal:3000` by default. Override it with:

```bash
BASE_URL=http://host.docker.internal:3000 npm run k6:products
```

If catalog tests return empty lists or `404` for demo products, reseed and sync again:

```bash
npm run seed:demo
curl -X POST http://localhost:3000/admin/sync/erp
```
