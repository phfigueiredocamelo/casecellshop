# CaseCellShop Backend Architecture Design

Data: 2026-05-28

## Objetivo

Desenhar uma mini-tarefa backend local para desacoplar um e-commerce monolitico do ERP core. A solucao deve atender vitrine e checkout sem consultar o ERP a cada acesso, usando banco proprio da loja, Redis, RabbitMQ, workers, DLQ, conciliacao, logs estruturados e metricas.

O foco e demonstrar boas decisoes tecnicas em entrevista, nao construir uma plataforma enterprise completa.

## Escopo Aprovado

A solucao sera um monorepo Node.js/NestJS com multiplos processos:

- API REST para catalogo, produtos, disponibilidade e checkout.
- Banco Postgres como espelho parcial da loja.
- Redis para cache da vitrine.
- RabbitMQ para faturamento assincrono no ERP, retry e DLQ.
- Worker de outbox para publicar eventos no RabbitMQ.
- Worker de faturamento para integrar pedidos com o ERP.
- Worker de conciliacao e sincronizacao ERP -> loja.
- Fake ERP para simular catalogo, estoque, faturamento e falhas.

Nao entram no escopo: front-end, pagamento real, autenticacao completa, CDC real, Kubernetes, dashboard completo ou microsservicos em repositorios separados.

## Arquitetura Geral

O ERP continua sendo fonte de verdade para cadastro, preco e estoque base. A loja mantem uma copia parcial e otimizada desses dados no Postgres. A vitrine le primeiro do Redis e depois do Postgres. O ERP nao participa do fluxo normal de leitura.

No checkout, a API valida idempotencia por usuario, baixa ou compromete estoque local com update atomico condicional, cria pedido, cria itens e grava um evento de outbox na mesma transacao. A resposta ao cliente e rapida, normalmente `202 Accepted`.

Depois do commit, o `outbox-worker` publica o evento no RabbitMQ. O `order-worker` consome a fila, chama o fake ERP de forma idempotente e atualiza o pedido. Falhas temporarias entram em retry com backoff. Falhas persistentes vao para DLQ e deixam o pedido como `ERP_FAILED` ou `NEEDS_REVIEW`.

O `reconciliation-worker` sincroniza catalogo e compara divergencias entre ERP e banco da loja.

## Containers

O `docker-compose.yml` deve subir:

- `api`: NestJS REST API.
- `outbox-worker`: publicador da transactional outbox.
- `order-worker`: consumidor da fila de faturamento.
- `reconciliation-worker`: sincronizacao e conciliacao.
- `fake-erp`: API REST simulada.
- `postgres`: banco da loja.
- `redis`: cache em memoria.
- `rabbitmq`: fila principal, retry e DLQ.
- `prometheus` opcional: leitura de `/metrics`, se houver tempo.

## Estrutura do Monorepo

```text
apps/
  api/
  outbox-worker/
  order-worker/
  reconciliation-worker/
  fake-erp/
libs/
  db/
  cache/
  queue/
  observability/
  contracts/
scripts/
  seed-demo-catalog/
  seed-large-catalog/
tests/
  integration/
  k6/
    products-load.js
    checkout-concurrency.js
    idempotency-retry.js
docker-compose.yml
README.md
```

Os processos ficam separados operacionalmente, mas compartilham libs de banco, fila, contratos e observabilidade para reduzir boilerplate.

## Modelo de Dados Minimo

```text
products
  id, sku, name, description, imageUrl, active, updatedAt

device_models
  id, brand, model, slug, active, updatedAt

product_compatibilities
  productId, deviceModelId

product_stats
  productId, popularityScore, viewsCount, soldCount, updatedAt

product_prices
  productId, priceCents, currency, updatedAt

inventory
  productId, erpQty, reservedQty, availableQty, version, updatedAt

catalog_versions
  scope, version, updatedAt

orders
  id, customerId, idempotencyKey, status, totalCents, currency,
  erpInvoiceId, failureReason, createdAt, updatedAt

order_items
  id, orderId, productId, sku, name, quantity, unitPriceCents

idempotency_keys
  id, customerId, key, requestHash, orderId, status,
  responseBody, createdAt, expiresAt

outbox_events
  id, aggregateType, aggregateId, eventType, payload,
  status, attempts, lastError, createdAt, publishedAt

integration_attempts
  id, orderId, operation, attemptNumber, status,
  errorMessage, correlationId, createdAt

erp_snapshots
  id, productId, erpAvailableQty, erpPriceCents, capturedAt
```

Constraints e indices essenciais:

- `UNIQUE (customerId, idempotencyKey)` em `orders`.
- `UNIQUE (customerId, key)` em `idempotency_keys`.
- `UNIQUE (sku)` em `products`.
- `UNIQUE (slug)` em `device_models`.
- `UNIQUE (productId, deviceModelId)` em `product_compatibilities`.
- `UNIQUE (scope)` em `catalog_versions`.
- Indices em `product_compatibilities(deviceModelId, productId)`.
- Indices em `product_prices(priceCents)` para ordenacao por preco.
- Indices em `product_stats(popularityScore)` para ordenacao por relevancia.
- Indices em `outbox_events(status, createdAt)` e `orders(status, updatedAt)`.

`order_items` guarda snapshot de `sku`, `name` e `unitPriceCents` para preservar historico mesmo se o produto for inativado depois.

`product_compatibilities` permite que uma capinha seja compativel com mais de um modelo de celular. Isso evita acoplar cada produto a um unico aparelho.

## Estados de Pedido

```text
PENDING_ERP   pedido aceito localmente, outbox criada, aguardando faturamento
BILLED        ERP faturou com sucesso
ERP_FAILED    tentativas esgotadas, mensagem enviada para DLQ
NEEDS_REVIEW  divergencia encontrada na conciliacao
```

O status inicial do pedido criado pelo checkout e `PENDING_ERP`. A resposta HTTP continua sendo `202 Accepted`, mas o estado persistido ja representa que o pedido aguarda integracao assincrona.

## Endpoints REST

```http
GET /health
GET /metrics

GET /products?device=:slug&brand=:brand&sort=:sort&page=:page&pageSize=:pageSize
GET /products/:id
GET /products/:id/availability

POST /checkout
GET /orders/:id
GET /orders/by-idempotency-key/:key

POST /admin/sync/erp
POST /admin/reconcile
GET /admin/dlq
POST /admin/dlq/:messageId/requeue
```

`POST /checkout` usa:

```http
X-Customer-Id: customer-123
Idempotency-Key: uuid-ou-chave-do-cliente
```

Body:

```json
{
  "items": [
    { "productId": "prod-1", "quantity": 2 }
  ]
}
```

Respostas esperadas:

- `202 Accepted`: pedido aceito e evento gravado na outbox.
- `200 OK`: repeticao idempotente ja concluida.
- `409 Conflict`: mesma chave com payload diferente ou operacao ainda em processamento.
- `422 Unprocessable Entity`: produto inativo ou estoque insuficiente.
- `503 Service Unavailable`: dependencia local essencial indisponivel, como Postgres.

`GET /orders/by-idempotency-key/:key` tambem exige `X-Customer-Id`, mantendo a consulta escopada ao usuario.

Filtros e ordenacoes aceitos em `GET /products`:

```text
device     slug do modelo de celular, como iphone-15 ou galaxy-s24
brand      marca do aparelho, como apple ou samsung
sort       relevance, price_asc ou price_desc
page       pagina, iniciando em 1
pageSize   tamanho da pagina, com limite maximo definido pela API
```

`sort=relevance` usa uma regra simples e explicavel para a mini-tarefa:

```text
popularityScore DESC, products.updatedAt DESC
```

A disponibilidade nao entra como criterio forte da relevancia, porque checkout altera estoque com alta frequencia. A lista fica estavel por filtro/sort, e a disponibilidade e hidratada por produto com TTL curto.

## Fluxo GET /products

1. API recebe a requisicao e cria ou propaga `requestId` e `correlationId`.
2. Normaliza filtros e ordenacao aceitos: `device`, `brand`, `sort`, `page` e `pageSize`.
3. Le a versao atual do catalogo em `catalog_versions`, podendo manter copia curta em Redis como `catalog:version:products`.
4. Monta uma chave canonica de query, sempre com parametros na mesma ordem.
5. Busca Redis pela lista de IDs e metadados da pagina.
6. Em cache hit, hidrata cards e disponibilidade via Redis e incrementa `cache_hits_total`.
7. Em cache miss, usa lock curto no Redis por chave de query para reduzir cache stampede.
8. Se adquirir o lock, consulta Postgres com filtros, joins e ordenacao, grava a pagina no Redis e retorna.
9. Se nao adquirir o lock, aguarda jitter curto e tenta reler o Redis.
10. Se ainda nao houver cache fresco, retorna stale cache quando existir valor expirado recente.
11. Apenas como ultimo recurso consulta Postgres, com limite de concorrencia por chave para nao transformar o banco na nova vitima do stampede.
12. Se Redis estiver indisponivel, registra erro e usa Postgres como fallback degradado.
13. O ERP nao e chamado nesse endpoint.

Exemplo:

```http
GET /products?device=iphone-15&sort=price_asc&page=1&pageSize=24
```

Chaves Redis derivadas:

```text
products:query:v42:brand=*:device=iphone-15:sort=price_asc:page=1:size=24
product:card:v42:{productId}
```

A chave `products:query` armazena IDs ordenados e metadados de paginacao. O card do produto armazena dados menos volateis como nome, SKU, imagem e preco. A disponibilidade fica separada por produto, com TTL menor.

Se a query existir mas algum card ou disponibilidade estiver ausente, a API recompõe apenas a chave faltante. Isso evita jogar fora a pagina inteira por causa de um item parcialmente expirado.

TTLs sugeridos:

```text
products:query:v{version}:...  60s a 120s, com stale por 5min a 10min
product:card:v{version}:{id}   5min
```

Refresh-ahead pode ser demonstrado por job simples para produtos mais acessados, medidos por contadores Redis como `product:views:{id}`.

## Fluxo POST /checkout

1. API exige `X-Customer-Id` e `Idempotency-Key`.
2. Calcula `requestHash` a partir do body normalizado.
3. Abre transacao no Postgres.
4. Tenta criar ou travar a linha em `idempotency_keys` para `(customerId, key)`.
5. Se a chave ja existe:
   - mesmo hash e status `COMPLETED`: retorna a resposta salva;
   - mesmo hash e status `PROCESSING`: retorna `409 Conflict` ou status atual;
   - hash diferente: retorna `409 Conflict`.
6. Busca produtos e precos atuais no Postgres.
7. Para cada item, executa update atomico condicional:

```sql
UPDATE inventory
SET available_qty = available_qty - :qty,
    reserved_qty = reserved_qty + :qty,
    version = version + 1,
    updated_at = now()
WHERE product_id = :productId
  AND available_qty >= :qty;
```

8. Se algum update afetar `0` linhas, faz rollback e retorna `422`.
9. Cria `orders` e `order_items` com status `PENDING_ERP`.
10. Cria `outbox_events` com evento `OrderAccepted` na mesma transacao.
11. Atualiza `idempotency_keys` com `orderId`, status `COMPLETED` e resposta canonica.
12. Faz commit.
13. Invalida cache de disponibilidade dos produtos comprados.
14. Retorna `202 Accepted`.

## Idempotencia

A idempotencia e escopada por usuario:

```text
UNIQUE (customerId, key)
```

A mesma chave para usuarios diferentes representa operacoes independentes. A mesma chave para o mesmo usuario retorna a resposta anterior se o payload for igual. Se o payload for diferente, retorna `409 Conflict`.

Em producao, `customerId` viria do token autenticado. Na mini-tarefa, ele sera simulado por `X-Customer-Id`.

## Estoque e Overselling

O checkout nao usa leitura seguida de escrita. Ele usa update condicional no banco:

```sql
WHERE product_id = :productId
  AND available_qty >= :qty
```

Isso garante que pedidos aceitos nunca excedam `availableQty`.

O estoque e modelado como:

```text
availableQty = erpQty - reservedQty
```

O sync ERP atualiza `erpQty`. O checkout incrementa `reservedQty` e decrementa `availableQty`. Assim, uma sincronizacao do ERP nao sobrescreve estoque ja comprometido pela loja.

Para a mini-tarefa, nao havera reserva com expiracao. O estoque fica comprometido quando o pedido e aceito localmente. Se o ERP falhar definitivamente, o pedido vira excecao operacional e a DLQ preserva rastreabilidade.

## Sincronizacao ERP -> Loja

Produtos novos, alterados ou removidos entram pelo fluxo de sync:

- seed inicial ao subir o ambiente;
- `POST /admin/sync/erp` para demonstracao;
- execucao periodica no `reconciliation-worker`.

Fluxo:

1. Worker ou API chama `GET /erp/products` no fake ERP.
2. Recebe `sku`, nome, descricao, preco, estoque, status e compatibilidades de aparelho.
3. Faz upsert em `products`, `device_models`, `product_compatibilities`, `product_prices` e `inventory`.
4. Produtos novos entram como `active = true`.
5. Produtos removidos ou desativados no ERP viram `active = false`.
6. Produtos inativos nao aparecem em `GET /products`.
7. Alteracoes em produto, preco, status ativo ou compatibilidade incrementam `catalog_versions`.
8. Cache relacionado e invalidado ou atualizado ativamente.

Nao ha hard delete de produtos para preservar historico de pedidos.

## Cache

A estrategia principal e cache-aside por consulta normalizada:

1. API normaliza filtros, ordenacao e paginacao.
2. API monta uma chave Redis deterministica.
3. Em hit, retorna IDs da pagina e hidrata dados auxiliares via Redis.
4. Em miss, consulta Postgres e popula Redis com TTL.
5. Em falha do Redis, a API usa Postgres como fallback degradado.

Exemplo de chave:

```text
products:query:v42:brand=*:device=iphone-15:sort=price_asc:page=1:size=24
```

O cache de listagem nao deve carregar dados altamente volateis como disponibilidade definitiva. A regra e:

```text
Cache de query        filtros + sort + paginacao -> IDs e metadados
Cache de card         nome, sku, imagem, preco
Cache de disponibilidade availableQty e inStock por produto
Checkout              sempre Postgres, nunca Redis
```

`catalog_versions` invalida familias inteiras de chaves sem precisar apagar todas manualmente. Quando sync ERP altera produto, preco, status ativo ou compatibilidade, a versao muda de `v42` para `v43`. Chaves antigas expiram por TTL. Checkout nao incrementa a versao de catalogo; ele invalida apenas disponibilidade dos produtos afetados.

Invalida ativa:

- sync ERP incrementa versao de catalogo e invalida disponibilidade quando estoque base muda;
- checkout invalida disponibilidade dos produtos comprados;
- reprocessamento administrativo de DLQ pode invalidar pedido e disponibilidade.

Protecao contra cache stampede:

- lock curto por chave quente ou por query normalizada;
- jitter e releitura do Redis para requests concorrentes;
- stale-while-revalidate quando houver valor expirado recente;
- stale-if-error quando Redis/Postgres estiverem degradados e houver stale aceitavel;
- fallback para Postgres apenas como ultimo recurso, com limite de concorrencia por chave.

O fallback para Postgres nao e a principal protecao contra stampede. Ele existe para disponibilidade degradada. A protecao real vem de lock, jitter, stale cache e limite de concorrencia.

## Mensageria, Retry e DLQ

Filas RabbitMQ:

```text
orders.billing.q
orders.billing.retry.q
orders.billing.dlq
```

O `outbox-worker`:

1. Busca `outbox_events` com status `PENDING`.
2. Publica no RabbitMQ com `messageId = outboxEvent.id`.
3. Envia headers `correlationId`, `orderId`, `customerId`, `idempotencyKey` e `attempt`.
4. Marca o evento como `PUBLISHED`.
5. Se falhar, incrementa `attempts`, registra `lastError` e tenta depois.

O `order-worker`:

1. Consome `orders.billing.q`.
2. Busca o pedido no Postgres.
3. Se o pedido ja esta `BILLED`, da ack sem chamar ERP.
4. Chama o fake ERP com chave idempotente `order:{orderId}:billing`.
5. Em sucesso, salva `erpInvoiceId`, muda pedido para `BILLED` e da ack.
6. Em falha temporaria, manda para `orders.billing.retry.q`.
7. A fila de retry usa TTL e volta para `orders.billing.q`.
8. Apos o limite de tentativas, marca pedido como `ERP_FAILED`, registra tentativa e envia para `orders.billing.dlq`.

A entrega e tratada como at-least-once. Por isso o worker precisa ser idempotente.

## Transactional Outbox

O pedido, seus itens, a baixa de estoque, a chave de idempotencia e o evento `OrderAccepted` sao persistidos na mesma transacao.

Isso evita:

- mensagem fantasma: mensagem publicada sem pedido persistido;
- pedido fantasma: pedido salvo sem evento publicavel;
- baixa duplicada: retry idempotente nao executa o estoque novamente.

## Worker de Conciliacao

O `reconciliation-worker` executa duas responsabilidades simples:

1. Sincronizacao ERP -> loja para catalogo, preco e estoque base.
2. Conciliacao de pedidos e divergencias.

Fluxo de conciliacao:

1. Busca pedidos `PENDING_ERP`, `ERP_FAILED` ou antigos sem `erpInvoiceId`.
2. Consulta fake ERP por `orderId`.
3. Se ERP faturou e loja nao atualizou, corrige para `BILLED`.
4. Se loja tem pedido sem ERP apos janela configurada, registra divergencia.
5. Compara amostra de preco/estoque entre ERP e Postgres.
6. Incrementa `reconciliation_divergences_total` quando houver diferenca.

## Observabilidade

Logs estruturados em JSON devem conter, quando aplicavel:

```text
timestamp
level
service
correlationId
requestId
operation
status
customerId
orderId
productId
idempotencyKey
error.message
error.stack
```

Eventos essenciais:

- cache hit, miss e fallback para Postgres;
- inicio e fim de checkout;
- conflito idempotente;
- rejeicao por estoque;
- criacao de pedido e outbox;
- publicacao outbox -> RabbitMQ;
- tentativa de faturamento no ERP;
- retry, DLQ e conciliacao.

Metricas em formato Prometheus:

```text
http_request_duration_seconds
redis_operation_duration_seconds
cache_hits_total
cache_misses_total
checkout_started_total
orders_accepted_total
orders_rejected_out_of_stock_total
idempotency_duplicate_total
outbox_pending_total
rabbitmq_queue_messages
rabbitmq_dlq_messages
worker_processing_duration_seconds
erp_request_duration_seconds
erp_errors_total
reconciliation_divergences_total
```

## Testes

Testes de integracao:

- `GET /products` retorna do Redis em cache hit.
- `GET /products` cai para Postgres em cache miss.
- `GET /products?device=iphone-15` retorna apenas produtos compativeis com o modelo.
- `GET /products?brand=apple` retorna apenas produtos compativeis com aparelhos da marca.
- `sort=price_asc` e `sort=price_desc` ordenam pelo preco atual.
- `sort=relevance` ordena por `popularityScore` e recencia.
- parametros em ordem diferente geram a mesma chave canonica de cache.
- checkout invalida `product:card:v{catalogVersion}:{productId}` sem invalidar todas as queries de listagem.
- sync ERP que altera preco, produto, status ou compatibilidade incrementa `catalog_versions`.
- cache stampede em query quente gera uma unica recomposicao principal e concorrentes usam releitura ou stale cache.
- Redis indisponivel nao derruba leitura da vitrine.
- `POST /checkout` cria pedido, itens, baixa estoque e outbox na mesma transacao.
- mesma chave, mesmo usuario e mesmo payload nao duplica pedido nem estoque.
- mesma chave, mesmo usuario e payload diferente retorna `409`.
- 20 checkouts simultaneos para estoque 1 resultam em 1 aceito e 19 rejeitados.
- `outbox-worker` publica evento e marca como `PUBLISHED`.
- `order-worker` fatura com sucesso no fake ERP.
- `order-worker` manda para DLQ apos falhas persistentes.
- sync ERP cria produto novo.
- sync ERP inativa produto removido.
- sync ERP nao sobrescreve estoque comprometido localmente.

Testes K6:

```text
tests/k6/products-load.js
  leitura massiva de GET /products, GET /products/:id e queries filtradas por aparelho,
  medicao de p95/p99, taxa de erro e cache hit ratio,
  mistura de sort=relevance, sort=price_asc e sort=price_desc,
  validacao de que ERP nao recebe chamadas de vitrine,
  validacao indireta de que queries quentes nao geram tempestade de leituras no Postgres.

tests/k6/checkout-concurrency.js
  checkouts concorrentes para SKUs com estoque limitado,
  validacao de que pedidos aceitos nunca excedem estoque disponivel,
  medicao de latencia ate 202.

tests/k6/idempotency-retry.js
  repeticao do mesmo checkout com a mesma Idempotency-Key,
  validacao de resposta estavel e ausencia de baixa duplicada.
```

Seeds:

```text
npm run seed:demo
  catalogo pequeno para entendimento e demo manual.

npm run seed:large
  10.000 produtos, precos variados, estoques variados,
  modelos de celular variados, compatibilidades muitos-para-muitos,
  alguns produtos inativos e alguns SKUs quentes para cache.
```

## Demo Esperada

O README deve permitir demonstrar:

```text
docker compose up
npm run seed:demo
curl GET /products
curl POST /checkout
repetir POST /checkout com mesma Idempotency-Key
simular falha ERP
ver mensagem na DLQ
rodar conciliacao
npm run seed:large
npm run test:k6
```

## Trade-offs

- `X-Customer-Id` substitui autenticacao real.
- Checkout nao inclui pagamento real.
- Sync ERP -> loja e manual/periodico, nao CDC.
- Estoque e comprometido no aceite do checkout; nao ha reserva com expiracao.
- Falha persistente no ERP vira excecao operacional, sem devolucao automatica de estoque.
- Produtos removidos do ERP viram `active=false`, sem hard delete.
- A loja tem consistencia forte interna; ERP e integrado com consistencia eventual.
- `/metrics` e logs estruturados bastam para observabilidade local.
- RabbitMQ local com retry por TTL demonstra backoff e DLQ sem complexidade extra.

## Criterio de Sucesso

A mini-tarefa sera considerada bem desenhada se demonstrar:

- vitrine sem dependencia direta do ERP;
- leitura com cache e fallback para banco proprio;
- checkout idempotente por usuario;
- prevencao de overselling por update atomico condicional;
- outbox transacional para evitar pedido ou mensagem fantasma;
- faturamento assincrono com retry e DLQ;
- sincronizacao e conciliacao ERP -> loja;
- logs, metricas e testes suficientes para explicar operacao e confiabilidade.
