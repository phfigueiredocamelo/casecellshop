# CaseCellShop Backend Architecture Design

Data: 2026-05-28
Atualizado em: 2026-05-30

## Objetivo

Desenhar e documentar uma mini-tarefa backend local para desacoplar um e-commerce monolitico do ERP core. A solucao atende vitrine e checkout sem consultar o ERP a cada acesso, usando banco proprio da loja, Redis, RabbitMQ, workers, DLQ, conciliacao, logs estruturados e metricas.

O foco e demonstrar boas decisoes tecnicas em entrevista, nao construir uma plataforma enterprise completa.

Esta revisao tambem reflete melhorias aplicadas depois da implementacao inicial: workers autonomos, endpoint real de metricas Prometheus, retry de conflitos transacionais no checkout, locks consultivos em ordem estavel, cache de cards aquecido em miss de catalogo, hidratacao batelada de cards, protecao contra stampede na hidratacao parcial, retry com jitter no lock de query e suite K6 local via Docker.

## Escopo Aprovado

A solucao sera um monorepo Node.js/NestJS com multiplos processos:

- API REST para catalogo, produtos com disponibilidade embutida no card, pedidos e checkout.
- Banco Postgres como espelho parcial da loja.
- Redis para cache da vitrine.
- RabbitMQ para faturamento assincrono no ERP, retry e DLQ.
- Worker de outbox para publicar eventos no RabbitMQ.
- Worker de faturamento para integrar pedidos com o ERP.
- Worker base de conciliacao e sincronizacao ERP -> loja, com runner acionado pela API administrativa no corte atual.
- Fake ERP para simular catalogo, estoque, faturamento e falhas.
- Observabilidade basica com `/health`, `/metrics`, metricas HTTP/cache e logger estruturado.
- Testes de integracao Jest e cenarios K6 locais via Docker.

Nao entram no escopo: front-end, pagamento real, autenticacao completa, CDC real, Kubernetes, dashboard completo ou microsservicos em repositorios separados.

## Arquitetura Geral

O ERP continua sendo fonte de verdade para cadastro, preco e estoque base. A loja mantem uma copia parcial e otimizada desses dados no Postgres. A vitrine le primeiro do Redis e, em miss de query com lock, consulta o Postgres para popular a cache. Quando o lock nao vem mesmo apos jitter curto, responde vazio com `retryLater`. O ERP nao participa do fluxo normal de leitura.

No checkout, a API valida idempotencia por usuario, baixa ou compromete estoque local com update atomico condicional, cria pedido, cria itens e grava um evento de outbox na mesma transacao. A resposta ao cliente e rapida, normalmente `202 Accepted`.

Depois do commit, o `outbox-worker` publica o evento no RabbitMQ. O `order-worker` consome a fila, chama o fake ERP de forma idempotente e atualiza o pedido. Falhas temporarias entram em retry por fila com TTL. Falhas persistentes vao para DLQ e deixam o pedido como `ERP_FAILED`.

A conciliacao usa o `ReconciliationRunner` para sincronizar catalogo e comparar divergencias entre ERP e banco da loja. No corte atual, essa rotina e acionada pelos endpoints administrativos. O processo `reconciliation-worker` ja sobe como worker autonomo e mantem heartbeat, mas ainda nao agenda a reconciliacao periodica sozinho.

## Execucao Local

O `docker-compose.yml` sobe apenas as dependencias locais:

- `postgres`: banco da loja.
- `redis`: cache em memoria.
- `rabbitmq`: fila principal, retry e DLQ.

Os processos NestJS rodam localmente pelo script `npm run start:stack`:

- `api`: NestJS REST API em `localhost:3000`.
- `fake-erp`: API REST simulada em `localhost:3001`.
- `outbox-worker`: publicador da transactional outbox.
- `order-worker`: consumidor da fila de faturamento.
- `reconciliation-worker`: processo autonomo de conciliacao/sync, hoje com heartbeat e runner compartilhado.

Prometheus nao faz parte do compose atual; o endpoint `/metrics` ja expoe metricas em formato Prometheus para scraping externo.

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
  config/
  observability/
prisma/
  schema.prisma
  seed-demo.ts
  seed-large.ts
scripts/
  start-stack.js
tests/
  integration/
  k6/
    smoke.js
    products-load.js
    products-cache.js
    checkout-concurrency.js
    idempotency-retry.js
docker-compose.yml
README.md
```

Os processos ficam separados operacionalmente, mas compartilham libs de banco, cache, fila, configuracao e observabilidade para reduzir boilerplate.

## Modelo de Dados Minimo

```text
products
  id, sku, name, description, imageUrl, brand, active, createdAt, updatedAt

device_models
  id, brand, model, slug, createdAt, updatedAt

product_compatibilities
  productId, deviceModelId, createdAt

product_stats
  productId, popularityScore, viewCount, soldCount, updatedAt

product_prices
  productId, priceCents, currency, updatedAt

inventory
  productId, erpQty, reservedQty, availableQty, version, updatedAt

catalog_versions
  key, version, updatedAt

orders
  id, customerId, idempotencyKey, status, totalCents, currency,
  erpInvoiceId, failureReason, createdAt, updatedAt

order_items
  id, orderId, productId, sku, productName, quantity, unitPriceCents, createdAt

idempotency_keys
  id, customerId, key, requestHash, orderId, status,
  responseBody, createdAt, updatedAt, expiresAt

outbox_events
  id, aggregateType, aggregateId, eventType, payload,
  status, attempts, lastError, createdAt, publishedAt, orderId

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
- `UNIQUE (slug)` e `UNIQUE (brand, model)` em `device_models`.
- chave primaria composta `(productId, deviceModelId)` em `product_compatibilities`.
- `key` como chave primaria em `catalog_versions`.
- Indices em `product_compatibilities(deviceModelId)`.
- Indices em `product_prices(priceCents)` para ordenacao por preco.
- Indices em `product_stats(popularityScore)` para ordenacao por relevancia.
- Indices em `outbox_events(status, createdAt)` e `orders(status, createdAt)`.
- `UNIQUE (orderId, operation, attemptNumber)` em `integration_attempts`.

`order_items` guarda snapshot de `sku`, `productName` e `unitPriceCents` para preservar historico mesmo se o produto for inativado depois.

`product_compatibilities` permite que uma capinha seja compativel com mais de um modelo de celular. Isso evita acoplar cada produto a um unico aparelho.

## Estados de Pedido

```text
PENDING_ERP   pedido aceito localmente, outbox criada, aguardando faturamento
BILLED        ERP faturou com sucesso
ERP_FAILED    tentativas esgotadas, mensagem enviada para DLQ
```

O status inicial do pedido criado pelo checkout e `PENDING_ERP`. A resposta HTTP continua sendo `202 Accepted`, mas o estado persistido ja representa que o pedido aguarda integracao assincrona.

Divergencias encontradas pela conciliacao sao reportadas no retorno administrativo e em metricas planejadas. O enum atual de pedido nao possui `NEEDS_REVIEW`; esse estado fica como possivel evolucao se a revisao operacional precisar ser persistida no pedido.

## Endpoints REST

```http
GET /health
GET /metrics

GET /products?device=:slug&brand=:brand&sort=:sort&page=:page&pageSize=:pageSize
GET /products/:id

POST /checkout
GET /orders/:id
GET /orders/by-idempotency-key/:key

POST /admin/sync/erp
POST /admin/reconcile
```

O fake ERP expoe separadamente:

```http
GET /health
GET /erp/products
POST /erp/catalog
POST /erp/billing
GET /erp/billing/:orderId
```

Inspecao e reenvio de DLQ ainda nao possuem endpoint administrativo na API. No corte atual, a DLQ e demonstrada pelo RabbitMQ Management UI (`localhost:15672`) e pelos testes do `order-worker`.

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
- `400 Bad Request`: headers obrigatorios ausentes ou body invalido.
- `422 Unprocessable Entity`: produto inativo ou estoque insuficiente.

`GET /orders/by-idempotency-key/:key` tambem exige `X-Customer-Id`, mantendo a consulta escopada ao usuario.

Filtros e ordenacoes aceitos em `GET /products`:

```text
device     slug do modelo de celular, como apple-iphone-15 ou samsung-galaxy-s24
brand      marca do produto/capa, como casecell no seed atual
sort       relevance, price_asc ou price_desc
page       pagina, iniciando em 1
pageSize   tamanho da pagina, limitado a 50
```

`sort=relevance` usa uma regra simples e explicavel para a mini-tarefa:

```text
popularityScore DESC, products.updatedAt DESC
```

A disponibilidade nao entra como criterio forte da relevancia, porque checkout altera estoque com alta frequencia. A lista fica estavel por filtro/sort, e a disponibilidade vem no card cacheado do produto, que e invalidado para os itens comprados.

## Fluxo GET /products

1. API recebe a requisicao.
2. Normaliza filtros e ordenacao aceitos: `device`, `brand`, `sort`, `page` e `pageSize`.
3. Le a versao atual do catalogo em `catalog_versions` usando a chave `catalog`.
4. Monta uma chave canonica de query, sempre com parametros na mesma ordem.
5. Busca Redis pela lista de IDs da pagina.
6. Em cache hit, hidrata cards com `MGET` batelado em `product:card:v{version}:{productId}`.
7. Se todos os cards existirem, retorna os cards na ordem da lista de IDs.
8. Se houver cards faltando, tenta adquirir um lock curto de hidratacao baseado no hash dos IDs faltantes.
9. Se adquirir o lock, consulta Postgres uma vez para os IDs faltantes, aquece os cards e recompõe a resposta.
10. Se outro processo ja tiver o lock, aguarda jitter curto, relê os cards faltantes e retorna resposta parcial com `meta.degraded=true` caso algum card continue ausente.
11. Em cache miss da query, tenta adquirir um lock curto no Redis por chave de query.
12. Se adquirir o lock de query, consulta Postgres com filtros, joins e ordenacao, grava a lista de IDs e aquece os cards.
13. Se nao adquirir o lock de query depois de um jitter curto, retorna `items: []` com `meta.cache=miss-locked` e `meta.retryLater=true`, sem consultar Postgres.
14. Se Redis estiver indisponivel e o lock de query nao puder ser obtido, a API segue o mesmo caminho de resposta vazia com `meta.cache=miss-locked` e `meta.retryLater=true`.
15. O ERP nao e chamado nesse endpoint.

Exemplo:

```http
GET /products?device=apple-iphone-15&sort=price_asc&page=1&pageSize=24
```

Chaves Redis derivadas:

```text
products:query:v42:brand=all:device=apple-iphone-15:sort=price_asc:page=1:size=24
product:card:v42:{productId}
```

A chave `products:query` armazena apenas IDs ordenados. O card do produto armazena o payload retornado pela vitrine: nome, SKU, imagem, marca, preco, `availableQty` e `inStock`.

Se a query existir mas algum card estiver ausente, a API recompõe apenas os cards faltantes. Isso evita jogar fora a pagina inteira por causa de um item parcialmente expirado.

TTLs sugeridos:

```text
products:query:v{version}:...  90s
product:card:v{version}:{id}   300s
```

Refresh-ahead, cache stale e uma chave separada para disponibilidade continuam como evolucoes possiveis. O corte atual prioriza demonstrar cache-aside, chave canonica, warm de cards e protecao contra stampede de hidratacao.

## Fluxo POST /checkout

1. API exige `X-Customer-Id` e `Idempotency-Key`.
2. Calcula `requestHash` a partir do body normalizado.
3. Abre transacao `Serializable` no Postgres.
4. Adquire lock consultivo transacional para `(customerId, idempotencyKey)`.
5. Adquire locks consultivos transacionais de inventario em ordem lexicografica de `productId`, reduzindo deadlocks em checkouts multi-item.
6. Busca a linha em `idempotency_keys` para `(customerId, key)`.
7. Se a chave ja existe:
   - mesmo hash e status `COMPLETED`: retorna a resposta salva;
   - mesmo hash e status `PROCESSING`: retorna `409 Conflict` ou status atual;
   - hash diferente: retorna `409 Conflict`.
8. Busca produtos e precos atuais no Postgres.
9. Para cada item, executa update atomico condicional:

```sql
UPDATE inventory
SET available_qty = available_qty - :qty,
    reserved_qty = reserved_qty + :qty,
    version = version + 1,
    updated_at = now()
WHERE product_id = :productId
  AND available_qty >= :qty;
```

10. Se algum update afetar `0` linhas, faz rollback e retorna `422`.
11. Cria `orders` e `order_items` com status `PENDING_ERP`.
12. Cria `outbox_events` com evento `OrderAccepted` na mesma transacao.
13. Cria `idempotency_keys` com `orderId`, status `COMPLETED` e resposta canonica.
14. Faz commit.
15. Invalida os cards de produto dos itens comprados, porque o card atual carrega `availableQty` e `inStock`.
16. Retorna `202 Accepted`.

O checkout envolve a transacao em retry curto para erros Prisma `P2034` (write conflict/deadlock), com backoff exponencial pequeno. Isso evita transformar disputa normal de estoque em erro 5xx nos cenarios de concorrencia local.

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

Como melhoria de robustez para a demo concorrente, o checkout tambem usa transacao `Serializable`, locks consultivos por idempotencia/inventario e retry de `P2034`. O update condicional continua sendo a garantia principal contra overselling; os locks e o retry reduzem falhas espurias sob disputa.

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
- runner compartilhado com o `reconciliation-worker`, com agendamento periodico ainda planejado.

Fluxo:

1. Worker ou API chama `GET /erp/products` no fake ERP.
2. Recebe `sku`, nome, descricao, preco, estoque, status e compatibilidades de aparelho.
3. Faz upsert em `products`, `device_models`, `product_compatibilities`, `product_prices`, `inventory` e `product_stats`.
4. Produtos novos entram como `active = true`.
5. Produtos removidos ou desativados no ERP viram `active = false`.
6. Produtos inativos nao aparecem em `GET /products`.
7. Compatibilidades do produto sao recriadas a cada sync para refletir o ERP.
8. `catalog_versions.key = catalog` e incrementado ao final de cada sync, invalidando familias de cache por versao.
9. O estoque local preserva reservas ja comprometidas: `availableQty = max(erpQty - reservedQty, 0)`.

Nao ha hard delete de produtos para preservar historico de pedidos.

## Cache

A estrategia principal e cache-aside por consulta normalizada:

1. API normaliza filtros, ordenacao e paginacao.
2. API monta uma chave Redis deterministica.
3. Em hit, retorna IDs da pagina e hidrata dados auxiliares via Redis.
4. Em miss, tenta um lock curto de query no Redis; se o lock vier, consulta Postgres e popula Redis com TTL.
5. Se o lock de query nao vier mesmo apos jitter curto, a API responde com lista vazia e `meta.retryLater=true`.

Exemplo de chave:

```text
products:query:v42:brand=all:device=apple-iphone-15:sort=price_asc:page=1:size=24
```

O corte atual usa duas familias principais de cache:

```text
Cache de query        filtros + sort + paginacao -> IDs ordenados
Cache de card         nome, sku, imagem, marca, preco, availableQty e inStock
Checkout              sempre Postgres, nunca Redis
```

`catalog_versions` invalida familias inteiras de chaves sem precisar apagar todas manualmente. Quando sync ERP roda, a versao muda de `v42` para `v43`. Chaves antigas expiram por TTL. Checkout nao incrementa a versao de catalogo; ele apaga apenas `product:card:v{catalogVersion}:{productId}` dos produtos comprados, porque o card carrega disponibilidade no desenho atual.

Invalida ativa:

- sync ERP incrementa versao de catalogo;
- checkout invalida cards dos produtos comprados;
- reprocessamento administrativo de DLQ ainda nao existe como endpoint, mas pode invalidar pedido e card em evolucao futura.

Protecao contra cache stampede:

- lock curto por query normalizada em miss de listagem;
- jitter curto e segunda tentativa antes de desistir do lock de query;
- resposta vazia com `meta.retryLater=true` quando outro processo continua com o lock de query;
- warm de cards quando a query e populada;
- `MGET` para hidratar cards em lote;
- lock curto por conjunto de cards faltantes;
- jitter e releitura do Redis quando outro processo ja esta hidratando cards;
- resposta parcial com `meta.degraded=true` e metrica `product_card_hydration_misses_total` quando um card continua ausente;
- consulta ao Postgres quando o lock de query e obtido e a pagina precisa ser populada.

Stale-while-revalidate, stale-if-error e limite explicito de concorrencia por chave permanecem como evolucoes possiveis. A protecao atual ja cobre os dois pontos que ficaram mais importantes na implementacao: query cache e hidratacao parcial de cards.

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
3. Envia headers `orderId`, `customerId` e `idempotencyKey`.
4. Marca o evento como `PUBLISHED`.
5. Se falhar, marca como `FAILED`, incrementa `attempts` e registra `lastError`.

O worker roda imediatamente no bootstrap e depois repete o ciclo a cada `WORKER_HEARTBEAT_MS`, usando o mesmo processo NestJS de longa duracao. Reprocessamento automatico de eventos `FAILED` ainda nao faz parte do corte atual.

O `order-worker`:

1. Consome `orders.billing.q`.
2. Busca o pedido no Postgres.
3. Se o pedido ja esta `BILLED`, da ack sem chamar ERP.
4. Chama o fake ERP com chave idempotente `order:{orderId}:billing`.
5. Em sucesso, salva `erpInvoiceId`, muda pedido para `BILLED` e da ack.
6. Em falha temporaria, manda para `orders.billing.retry.q`.
7. A fila de retry usa TTL de 15s e volta para `orders.billing.q`.
8. Apos o limite de tentativas, marca pedido como `ERP_FAILED`, registra tentativa e envia para `orders.billing.dlq`.

A entrega e tratada como at-least-once. Por isso o worker precisa ser idempotente.

O limite atual e de 4 tentativas. `integration_attempts` e gravada para falhas e DLQ; no sucesso, o historico fica no proprio pedido (`status=BILLED`, `erpInvoiceId`).

## Transactional Outbox

O pedido, seus itens, a baixa de estoque, a chave de idempotencia e o evento `OrderAccepted` sao persistidos na mesma transacao.

Isso evita:

- mensagem fantasma: mensagem publicada sem pedido persistido;
- pedido fantasma: pedido salvo sem evento publicavel;
- baixa duplicada: retry idempotente nao executa o estoque novamente.

## Conciliacao

O `ReconciliationRunner` executa duas responsabilidades simples:

1. Sincronizacao ERP -> loja para catalogo, preco e estoque base.
2. Conciliacao de pedidos e divergencias.

Hoje essas rotinas sao acionadas por `POST /admin/sync/erp` e `POST /admin/reconcile`. O processo `reconciliation-worker` ja e iniciado pelo `start:stack` e permanece vivo, mas ainda nao agenda chamadas periodicas ao runner.

Fluxo de conciliacao:

1. Busca pedidos `PENDING_ERP` ou `ERP_FAILED`.
2. Consulta fake ERP por `orderId`.
3. Se ERP faturou e loja nao atualizou, corrige para `BILLED`.
4. Se loja tem pedido sem invoice no ERP, conta divergencia no retorno administrativo.

Comparacao amostral de preco/estoque e metrica `reconciliation_divergences_total` continuam como extensoes planejadas.

## Observabilidade

O modulo `observability` ja expoe `/metrics` em formato Prometheus e registra metricas HTTP por interceptor global. Tambem existe `LoggerService` com Pino para logs JSON; alguns workers ainda usam `Logger` padrao do Nest, mas a base para logs estruturados ja esta no monorepo.

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

Metricas implementadas em formato Prometheus:

```text
http_request_duration_seconds
cache_hits_total
cache_misses_total
product_card_hydration_misses_total
metricas default do prom-client
```

Metricas ainda planejadas:

```text
redis_operation_duration_seconds
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

Testes de integracao atuais:

- bootstrap da API, fake ERP e workers de longa duracao.
- `/health` e `/metrics` atraves do grafo Nest.
- interceptor HTTP registrando `http_request_duration_seconds`.
- metricas de cache e `product_card_hydration_misses_total`.
- chave canonica de cache para queries de produto.
- filtro por `device` usando compatibilidade.
- hidratacao de IDs cacheados com `MGET` e uma unica busca batelada no Postgres.
- warm de `product:card` ao popular uma query em miss.
- retorno vazio com `retryLater` quando outro processo segura o lock de query.
- resposta degradada quando outro processo segura o lock de hidratacao de cards faltantes.
- invalidacao apenas dos cards dos produtos afetados pelo checkout.
- checkout idempotente retorna `202` no primeiro aceite e `200` no replay.
- mesma chave, mesmo usuario e payload diferente retorna `409`.
- checkouts concorrentes para estoque limitado aceitam apenas uma compra.
- retry de conflitos Prisma `P2034`.
- locks consultivos em ordem estavel antes de mutar inventario.
- sync ERP cria/atualiza produto, preco, inventario, stats e compatibilidades.
- sync ERP preserva estoque reservado localmente ao recalcular `availableQty`.
- sync ERP inativa produtos ausentes no ERP.
- conciliacao repara pedido ja faturado no ERP e conta divergencias.
- `outbox-worker` publica evento pendente e marca como `PUBLISHED`.
- `outbox-worker` faz flush no bootstrap e continua polling por heartbeat.
- `order-worker` consome `orders.billing.q`, chama ERP e da ack.
- `order-worker` marca pedido como `BILLED` em sucesso.
- `order-worker` registra tentativa e envia para DLQ apos limite de falhas.
- schema Prisma contem os modelos esperados.

Testes K6:

```text
tests/k6/smoke.js
  verificacao curta de GET /health, GET /products e GET /products/:id,
  baseline recomendado antes dos cenarios maiores.

tests/k6/products-load.js
  leitura massiva de GET /products com queries filtradas por aparelho,
  medicao de p95/p99, taxa de erro e cache hit ratio,
  mistura de sort=relevance, sort=price_asc e sort=price_desc,
  validacao funcional de status 200, `items` e `meta`.

tests/k6/products-cache.js
  warm-up curto de listagem e produto individual,
  leitura repetida para exercitar caminho quente de catalogo e cards.

tests/k6/checkout-concurrency.js
  checkouts concorrentes para SKUs com estoque limitado,
  validacao de que pedidos aceitos nunca excedem estoque disponivel,
  validacao de que a API permanece em `202`, `409` ou `422`, sem 5xx esperado.

tests/k6/idempotency-retry.js
  repeticao do mesmo checkout com a mesma Idempotency-Key,
  validacao de resposta estavel e ausencia de baixa duplicada.
```

Os comandos NPM atuais rodam K6 via Docker, evitando dependencia global do binario:

```text
npm run k6:smoke
npm run k6:products
npm run k6:products-cache
npm run k6:checkout
npm run k6:idempotency
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
cp .env.example .env
docker compose up -d postgres redis rabbitmq
npm install
npm run build
npm run prisma:generate
DATABASE_URL=postgresql://casecellshop:casecellshop@localhost:5432/casecellshop XDG_CACHE_HOME=.cache ./node_modules/.bin/prisma db push --accept-data-loss --force-reset
npm run start:stack
npm run seed:demo
curl -X POST http://localhost:3000/admin/sync/erp
curl http://localhost:3000/products
curl -X POST http://localhost:3000/checkout
repetir POST /checkout com mesma Idempotency-Key
validar retry/DLQ pela suite de workers
curl -X POST http://localhost:3000/admin/reconcile
npm test
npm run seed:large
npm run k6:smoke
npm run k6:products
npm run k6:products-cache
npm run k6:checkout
npm run k6:idempotency
```

## Trade-offs

- `X-Customer-Id` substitui autenticacao real.
- Checkout nao inclui pagamento real.
- Sync ERP -> loja e manual/periodico, nao CDC.
- Estoque e comprometido no aceite do checkout; nao ha reserva com expiracao.
- Falha persistente no ERP vira excecao operacional, sem devolucao automatica de estoque.
- Produtos removidos do ERP viram `active=false`, sem hard delete.
- A loja tem consistencia forte interna; ERP e integrado com consistencia eventual.
- `/metrics` e logs estruturados bastam para observabilidade local; as metricas de negocio ainda sao incrementais.
- RabbitMQ local com retry por TTL demonstra backoff e DLQ sem complexidade extra.
- `docker-compose.yml` sobe infraestrutura; apps e workers rodam localmente via `npm run start:stack`.
- O repo usa `prisma db push` para setup local e ainda nao versiona migrations.
- Nao ha endpoint administrativo para inspecionar/reprocessar DLQ; a demo usa RabbitMQ Management UI e testes.
- A disponibilidade esta embutida no `product:card` atual. Separar `product:availability` reduziria churn de cards, mas ficou fora do corte.
- O `reconciliation-worker` permanece vivo com heartbeat, mas a conciliacao periodica automatica ainda e evolucao futura.

## Criterio de Sucesso

A mini-tarefa sera considerada bem desenhada se demonstrar:

- vitrine sem dependencia direta do ERP;
- leitura com cache e fallback para banco proprio;
- cache de catalogo com chave canonica, warm de cards e protecao contra hidratacao concorrente;
- checkout idempotente por usuario;
- prevencao de overselling por update atomico condicional;
- robustez sob concorrencia com transacao serializable, locks consultivos e retry de `P2034`;
- outbox transacional para evitar pedido ou mensagem fantasma;
- faturamento assincrono com retry e DLQ;
- sincronizacao e conciliacao ERP -> loja;
- workers autonomos executando ciclos/consumo sem chamada manual;
- logs, metricas e testes suficientes para explicar operacao e confiabilidade;
- suite K6 local via Docker para smoke, catalogo, cache, checkout concorrente e idempotencia.
