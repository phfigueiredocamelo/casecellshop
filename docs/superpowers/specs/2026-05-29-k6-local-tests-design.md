# CaseCellShop K6 Local Tests Design

Data: 2026-05-29

## Objetivo

Implementar e documentar uma suite K6 para desenvolvimento local do CaseCellShop.
A suite deve ajudar a validar comportamento e regressao de performance em catalogo e checkout, sem exigir instalacao local do binario `k6`.

O foco e uso manual durante desenvolvimento local. Nao e um benchmark formal de producao nem um gate rigido de CI.

## Escopo Aprovado

- Rodar K6 via Docker, usando a imagem oficial `grafana/k6`.
- Manter comandos simples via `npm run k6:*`.
- Usar `BASE_URL=http://host.docker.internal:3000` como padrao para o container acessar a API local.
- Documentar pre-requisitos, seed recomendado, sync ERP -> Postgres, comandos, cenarios e interpretacao dos thresholds.
- Ajustar os scripts K6 existentes para ficarem mais claros e previsiveis em ambiente local.
- Adicionar um smoke test rapido para validar a stack antes de rodar carga maior.

Fora do escopo:

- Instalacao global do K6.
- Execucao obrigatoria em CI.
- Dashboards externos ou exportacao para Prometheus/Grafana.
- Testes de stress destrutivos ou de longa duracao.

## Cenários

### Smoke Local

Arquivo sugerido: `tests/k6/smoke.js`

Valida rapidamente que a API esta pronta para os demais testes:

- `GET /health` retorna `200`.
- `GET /products?page=1&pageSize=1` retorna `200` e pelo menos estrutura valida.
- `GET /products/prod_case_iphone_15_clear` retorna `200` depois de `npm run seed:demo` e `POST /admin/sync/erp`.

Thresholds sugeridos:

- `http_req_failed rate<0.01`.
- `http_req_duration p(95)<500`.

Esse teste deve ser curto, com poucas iteracoes, para rodar antes dos cenarios mais caros.

### Products Load

Arquivo existente: `tests/k6/products-load.js`

Exercita a listagem de produtos com filtros de vitrine:

- `device=apple-iphone-15`.
- `sort=relevance`, `price_asc` e `price_desc`.
- `page=1` e `pageSize=24`.

Objetivos:

- Validar latencia da listagem sob carga local moderada.
- Observar estabilidade do cache de query e hidratacao de produtos.
- Capturar regressao obvia em filtros, ordenacao e paginacao.

Thresholds sugeridos:

- `http_req_failed rate<0.01`.
- `http_req_duration p(95)<300` para ambiente local saudavel, aceitando ajuste se a maquina estiver sob carga.

### Product Cache

Arquivo sugerido: `tests/k6/products-cache.js`

Repete consultas iguais para produto individual e listagem, alternando pequeno warm-up e carga curta.

Objetivos:

- Exercitar o caminho frio e quente de `GET /products`.
- Exercitar `GET /products/:id`.
- Ajudar a perceber regressao em cache sem depender de inspecao manual do Redis.

Esse teste deve continuar simples. Ele valida resposta HTTP e latencia; nao deve tentar provar internamente que houve cache hit.

### Checkout Concurrency

Arquivo existente: `tests/k6/checkout-concurrency.js`

Simula compradores concorrendo por estoque local.

Objetivos:

- Confirmar que checkout responde `202` para pedidos aceitos.
- Aceitar `409` para idempotencia em processamento ou conflito esperado.
- Aceitar `422` quando estoque acabar, se o teste usar um produto com estoque limitado.
- Confirmar que a API nao retorna erro 5xx em concorrencia normal.

Os dados devem ser previsiveis. O README deve orientar rodar `npm run seed:demo` ou `npm run seed:large` e depois `POST /admin/sync/erp` antes do teste, conforme o produto usado pelo script.

### Idempotency Retry

Arquivo existente: `tests/k6/idempotency-retry.js`

Valida comportamento de idempotencia:

- Primeira requisicao com chave nova retorna `202` ou `200`.
- Segunda requisicao com mesma chave e payload igual retorna replay `200`.
- Requisicao com mesma chave e payload diferente retorna `409`.

Esse cenario e funcional e de resiliencia, nao de carga. Deve usar poucas iteracoes e chaves controladas.

## Scripts NPM

Os scripts `k6:*` devem chamar Docker em vez de depender de `k6` instalado globalmente.

Formato conceitual:

```bash
docker run --rm \
  -e BASE_URL=${BASE_URL:-http://host.docker.internal:3000} \
  -v "$PWD/tests/k6:/scripts" \
  grafana/k6 run /scripts/products-load.js
```

Como o container Docker nao acessa a API do host por `localhost`, a documentacao deve destacar `host.docker.internal`.

Scripts esperados:

- `npm run k6:smoke`
- `npm run k6:products`
- `npm run k6:products-cache`
- `npm run k6:checkout`
- `npm run k6:idempotency`

## Documentacao

O README deve ter uma secao K6 com:

- Explicacao de que os testes rodam via Docker.
- Como subir dependencias e aplicacao local.
- Como seedar dados no fake ERP e sincronizar o catalogo para o Postgres da loja.
- Como rodar cada script.
- Como sobrescrever `BASE_URL`.
- O que cada cenario valida.
- Nota explicita para o erro `sh: k6: command not found`: os scripts passam a usar Docker para evitar a dependencia global.

Exemplo esperado:

```bash
npm run start:stack
npm run seed:demo
curl -X POST http://localhost:3000/admin/sync/erp
npm run k6:smoke
npm run k6:products
```

## Erros e Limites

- Se Docker nao estiver disponivel, os comandos devem falhar de forma natural com erro do Docker; o README deve citar Docker como pre-requisito.
- Se a API nao estiver em execucao, os testes devem mostrar falhas de conexao e o README deve orientar rodar `npm run start:stack`.
- Se os dados seedados nao existirem no fake ERP, os testes devem falhar em checks funcionais claros, nao apenas por latencia. O README deve indicar `npm run seed:demo` como baseline dos scripts locais.
- Se o catalogo do fake ERP nao tiver sido sincronizado para o Postgres da loja, os testes de catalogo devem falhar de forma clara. O README deve indicar `POST /admin/sync/erp` depois do seed.
- Thresholds devem ser conservadores para desenvolvimento local e podem ser ajustados depois que houver baseline real na maquina do projeto.

## Criterios de Aceite

- `npm run k6:products` nao depende mais de binario `k6` instalado localmente.
- Existe documentacao suficiente para um desenvolvedor rodar a suite local do zero.
- Os cenarios cobrem listagem, cache de produtos, checkout concorrente, idempotencia e smoke da API.
- Os scripts usam `BASE_URL` configuravel.
- Os testes continuam pequenos o bastante para uso manual frequente.
