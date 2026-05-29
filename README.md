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

## k6 Scenarios

```bash
npm run k6:products
npm run k6:checkout
npm run k6:idempotency
```

Set `BASE_URL` to point at another environment if needed:

```bash
BASE_URL=http://localhost:3000 npm run k6:products
```
