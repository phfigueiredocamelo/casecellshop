# casecellshop

## Bootstrap smoke check

```bash
docker compose up -d postgres redis rabbitmq
npm install
npm run build
npm test
```

Expected:
- postgres healthy
- redis running
- rabbitmq running
- Nest apps build successfully
- bootstrap integration tests pass

## Run the local stack

```bash
cp .env.example .env
npm run start:stack
```

Services exposed by the bootstrap:
- API: `GET /health` on `http://localhost:3000`
- fake ERP: `GET /health` on `http://localhost:3001`
- workers: long-lived Nest application contexts with heartbeat logs

## Seed and load

```bash
npm run seed:demo
npm run seed:large
```

## K6 local scenarios

The K6 scripts run through Docker, so you do not need to install the `k6` binary on your machine. This avoids `sh: k6: command not found`.

Prepare the local stack and demo catalog:

```bash
docker compose up -d postgres redis rabbitmq
npm run prisma:generate
DATABASE_URL=postgresql://casecellshop:casecellshop@localhost:5432/casecellshop XDG_CACHE_HOME=.cache ./node_modules/.bin/prisma db push --accept-data-loss --force-reset
npm run build
npm run start:stack
npm run seed:demo
curl -X POST http://localhost:3000/admin/sync/erp
```

`seed:demo` and `seed:large` load the fake ERP in memory. The API reads catalog data from Postgres, so run `POST /admin/sync/erp` after seeding. The local database is created directly from `prisma/schema.prisma` with `prisma db push --force-reset` because this repo does not ship migrations yet.

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
