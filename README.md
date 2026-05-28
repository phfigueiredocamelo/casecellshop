# casecellshop

## Bootstrap smoke check

```bash
docker compose up -d postgres redis rabbitmq
docker compose ps
```

Expected:
- postgres healthy
- redis running
- rabbitmq running
