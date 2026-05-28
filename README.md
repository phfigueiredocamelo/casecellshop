# casecellshop

## Bootstrap smoke check

```bash
docker compose up -d postgres redis rabbitmq
/Users/paulocamelo/.nvm/versions/node/v24.16.0/bin/npm install
/Users/paulocamelo/.nvm/versions/node/v24.16.0/bin/npm run build
/Users/paulocamelo/.nvm/versions/node/v24.16.0/bin/npm test
```

Expected:
- postgres healthy
- redis running
- rabbitmq running
- Nest apps build successfully
- bootstrap integration tests pass

## Run the local stack

```bash
/Users/paulocamelo/.nvm/versions/node/v24.16.0/bin/npm run start:stack
```

Services exposed by the bootstrap:
- API: `GET /health` on `http://localhost:3000`
- fake ERP: `GET /health` on `http://localhost:3001`
- workers: long-lived Nest application contexts with heartbeat logs

## Seed and load

```bash
/Users/paulocamelo/.nvm/versions/node/v24.16.0/bin/npm run seed:demo
/Users/paulocamelo/.nvm/versions/node/v24.16.0/bin/npm run seed:large
```

## k6 Scenarios

```bash
/Users/paulocamelo/.nvm/versions/node/v24.16.0/bin/npm run k6:products
/Users/paulocamelo/.nvm/versions/node/v24.16.0/bin/npm run k6:checkout
/Users/paulocamelo/.nvm/versions/node/v24.16.0/bin/npm run k6:idempotency
```

Set `BASE_URL` to point at another environment if needed:

```bash
BASE_URL=http://localhost:3000 /Users/paulocamelo/.nvm/versions/node/v24.16.0/bin/npm run k6:products
```
