# K6 Local Tests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Docker-based K6 local test suite for CaseCellShop that covers smoke, catalog load/cache, checkout concurrency, and idempotency.

**Architecture:** Keep all K6 scripts in `tests/k6` and run them through `npm` scripts that invoke `grafana/k6` in Docker. Use the demo catalog as the baseline data set, then require `POST /admin/sync/erp` so the API reads products from Postgres instead of only the fake ERP memory store.

**Tech Stack:** Node.js npm scripts, Docker, `grafana/k6`, NestJS API, fake ERP seed scripts, Postgres catalog sync through `POST /admin/sync/erp`.

---

## File Structure

- Create: `tests/k6/helpers.js`
  Shared constants and small helper functions for K6 scripts: default base URL, demo product IDs, JSON headers, and response body parsing.
- Create: `tests/k6/smoke.js`
  Fast readiness test for `/health`, `/products`, and a known demo product.
- Create: `tests/k6/products-cache.js`
  Local cache-oriented scenario that warms and repeats catalog/product reads.
- Modify: `tests/k6/products-load.js`
  Use Docker-friendly default `BASE_URL`, rotate realistic query variants, and assert response shape.
- Modify: `tests/k6/checkout-concurrency.js`
  Use demo product IDs and accept expected local concurrency outcomes.
- Modify: `tests/k6/idempotency-retry.js`
  Use demo product IDs, add divergent-payload conflict check, and use unique customer/key values per iteration.
- Modify: `package.json`
  Replace direct `k6 run` scripts with Docker-backed commands and add scripts for smoke/cache.
- Modify: `README.md`
  Document Docker K6 usage, seed + sync order, scenario purpose, `BASE_URL`, and the `k6: command not found` fix.

---

### Task 1: Add Shared K6 Helpers

**Files:**
- Create: `tests/k6/helpers.js`

- [ ] **Step 1: Create helper module**

Create `tests/k6/helpers.js`:

```javascript
export const BASE_URL = __ENV.BASE_URL || 'http://host.docker.internal:3000';

export const DEMO_PRODUCTS = {
  iphone15Clear: 'prod_case_iphone_15_clear',
  iphone15ProBlack: 'prod_case_iphone_15_pro_black',
  galaxyS24Blue: 'prod_case_galaxy_s24_blue',
  magsafeMultifit: 'prod_case_multifit_magsafe'
};

export function jsonHeaders(extra = {}) {
  return {
    headers: {
      'Content-Type': 'application/json',
      ...extra
    }
  };
}

export function parseJson(response) {
  try {
    return response.json();
  } catch {
    return null;
  }
}

export function uniqueId(prefix) {
  return `${prefix}-${__VU}-${__ITER}-${Math.random().toString(36).slice(2, 10)}`;
}
```

- [ ] **Step 2: Run a syntax check through Docker**

Run:

```bash
docker run --rm -v "$PWD/tests/k6:/scripts" grafana/k6 inspect /scripts/helpers.js
```

Expected: command exits `0`. It may print script metadata; it must not print JavaScript syntax errors.

- [ ] **Step 3: Commit**

```bash
git add tests/k6/helpers.js
git commit -m "test: add k6 shared helpers"
```

---

### Task 2: Add K6 Smoke Scenario

**Files:**
- Create: `tests/k6/smoke.js`

- [ ] **Step 1: Write smoke scenario**

Create `tests/k6/smoke.js`:

```javascript
import http from 'k6/http';
import { check } from 'k6';
import { BASE_URL, DEMO_PRODUCTS, parseJson } from './helpers.js';

export const options = {
  vus: 1,
  iterations: 3,
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<500']
  }
};

export default function () {
  const health = http.get(`${BASE_URL}/health`);
  check(health, {
    'health returns 200': (r) => r.status === 200
  });

  const products = http.get(`${BASE_URL}/products?page=1&pageSize=1`);
  const productsBody = parseJson(products);
  check(products, {
    'products returns 200': (r) => r.status === 200,
    'products response has items': () => Array.isArray(productsBody?.items),
    'products response has at least one item': () => (productsBody?.items?.length ?? 0) > 0
  });

  const product = http.get(`${BASE_URL}/products/${DEMO_PRODUCTS.iphone15Clear}`);
  const productBody = parseJson(product);
  check(product, {
    'demo product returns 200': (r) => r.status === 200,
    'demo product id matches seed': () => productBody?.id === DEMO_PRODUCTS.iphone15Clear
  });
}
```

- [ ] **Step 2: Run against prepared local stack**

Prepare data:

```bash
npm run start:stack
npm run seed:demo
curl -X POST http://localhost:3000/admin/sync/erp
```

Run:

```bash
docker run --rm -e BASE_URL=http://host.docker.internal:3000 -v "$PWD/tests/k6:/scripts" grafana/k6 run /scripts/smoke.js
```

Expected: all checks pass; if product checks fail with `404`, run `curl -X POST http://localhost:3000/admin/sync/erp` and rerun.

- [ ] **Step 3: Commit**

```bash
git add tests/k6/smoke.js
git commit -m "test: add k6 smoke scenario"
```

---

### Task 3: Update Products Load Scenario

**Files:**
- Modify: `tests/k6/products-load.js`

- [ ] **Step 1: Replace current script**

Replace `tests/k6/products-load.js` with:

```javascript
import http from 'k6/http';
import { check, sleep } from 'k6';
import { BASE_URL, parseJson } from './helpers.js';

export const options = {
  vus: 20,
  duration: '30s',
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<300']
  }
};

const queries = [
  '/products?device=apple-iphone-15&sort=relevance&page=1&pageSize=24',
  '/products?device=apple-iphone-15&sort=price_asc&page=1&pageSize=24',
  '/products?device=apple-iphone-15&sort=price_desc&page=1&pageSize=24',
  '/products?device=apple-iphone-15-pro&sort=relevance&page=1&pageSize=24',
  '/products?device=samsung-galaxy-s24&sort=relevance&page=1&pageSize=24'
];

export default function () {
  const path = queries[(__VU + __ITER) % queries.length];
  const response = http.get(`${BASE_URL}${path}`);
  const body = parseJson(response);

  check(response, {
    'products status 200': (r) => r.status === 200,
    'products body has items array': () => Array.isArray(body?.items),
    'products body has meta': () => typeof body?.meta === 'object' && body?.meta !== null
  });

  sleep(0.2);
}
```

- [ ] **Step 2: Run the scenario**

Run:

```bash
docker run --rm -e BASE_URL=http://host.docker.internal:3000 -v "$PWD/tests/k6:/scripts" grafana/k6 run /scripts/products-load.js
```

Expected: checks pass, `http_req_failed` stays below `1%`, and p95 duration is below `300ms` on a healthy local stack.

- [ ] **Step 3: Commit**

```bash
git add tests/k6/products-load.js
git commit -m "test: improve k6 products load scenario"
```

---

### Task 4: Add Product Cache Scenario

**Files:**
- Create: `tests/k6/products-cache.js`

- [ ] **Step 1: Write cache-oriented scenario**

Create `tests/k6/products-cache.js`:

```javascript
import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { BASE_URL, DEMO_PRODUCTS, parseJson } from './helpers.js';

export const options = {
  scenarios: {
    warm_cache: {
      executor: 'shared-iterations',
      vus: 1,
      iterations: 5,
      maxDuration: '15s',
      exec: 'warmCache'
    },
    read_cache: {
      executor: 'constant-vus',
      vus: 10,
      duration: '20s',
      startTime: '15s',
      exec: 'readCache'
    }
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<250']
  }
};

const catalogPath = '/products?device=apple-iphone-15&sort=relevance&page=1&pageSize=24';

export function warmCache() {
  group('warm catalog and product cache', () => {
    http.get(`${BASE_URL}${catalogPath}`);
    http.get(`${BASE_URL}/products/${DEMO_PRODUCTS.iphone15Clear}`);
  });
}

export function readCache() {
  const list = http.get(`${BASE_URL}${catalogPath}`);
  const listBody = parseJson(list);
  check(list, {
    'cached list returns 200': (r) => r.status === 200,
    'cached list has items': () => (listBody?.items?.length ?? 0) > 0
  });

  const product = http.get(`${BASE_URL}/products/${DEMO_PRODUCTS.iphone15Clear}`);
  const productBody = parseJson(product);
  check(product, {
    'cached product returns 200': (r) => r.status === 200,
    'cached product id matches': () => productBody?.id === DEMO_PRODUCTS.iphone15Clear
  });

  sleep(0.2);
}
```

- [ ] **Step 2: Run the scenario**

Run:

```bash
docker run --rm -e BASE_URL=http://host.docker.internal:3000 -v "$PWD/tests/k6:/scripts" grafana/k6 run /scripts/products-cache.js
```

Expected: checks pass. The test validates stable cached read behavior through HTTP response and latency; it does not assert Redis internals.

- [ ] **Step 3: Commit**

```bash
git add tests/k6/products-cache.js
git commit -m "test: add k6 product cache scenario"
```

---

### Task 5: Update Checkout Concurrency Scenario

**Files:**
- Modify: `tests/k6/checkout-concurrency.js`

- [ ] **Step 1: Replace current script**

Replace `tests/k6/checkout-concurrency.js` with:

```javascript
import http from 'k6/http';
import { check, sleep } from 'k6';
import { BASE_URL, DEMO_PRODUCTS, jsonHeaders, uniqueId } from './helpers.js';

export const options = {
  vus: 10,
  iterations: 20,
  thresholds: {
    http_req_failed: ['rate<0.05']
  }
};

export default function () {
  const customerId = uniqueId('customer-checkout');
  const idempotencyKey = uniqueId('checkout-key');
  const response = http.post(
    `${BASE_URL}/checkout`,
    JSON.stringify({
      items: [{ productId: DEMO_PRODUCTS.iphone15Clear, quantity: 1 }]
    }),
    jsonHeaders({
      'X-Customer-Id': customerId,
      'Idempotency-Key': idempotencyKey
    })
  );

  check(response, {
    'checkout returns expected status': (r) => [202, 409, 422].includes(r.status),
    'checkout does not return 5xx': (r) => r.status < 500
  });

  sleep(0.1);
}
```

- [ ] **Step 2: Run after resetting demo data**

Because this test consumes stock, reset local data first:

```bash
npm run seed:demo
curl -X POST http://localhost:3000/admin/sync/erp
docker run --rm -e BASE_URL=http://host.docker.internal:3000 -v "$PWD/tests/k6:/scripts" grafana/k6 run /scripts/checkout-concurrency.js
```

Expected: accepted orders return `202`; after stock pressure, `422` is acceptable; no response should be `5xx`.

- [ ] **Step 3: Commit**

```bash
git add tests/k6/checkout-concurrency.js
git commit -m "test: stabilize k6 checkout concurrency"
```

---

### Task 6: Update Idempotency Scenario

**Files:**
- Modify: `tests/k6/idempotency-retry.js`

- [ ] **Step 1: Replace current script**

Replace `tests/k6/idempotency-retry.js` with:

```javascript
import http from 'k6/http';
import { check } from 'k6';
import { BASE_URL, DEMO_PRODUCTS, jsonHeaders, uniqueId } from './helpers.js';

export const options = {
  vus: 1,
  iterations: 5,
  thresholds: {
    http_req_failed: ['rate<0.01']
  }
};

export default function () {
  const customerId = uniqueId('customer-idem');
  const key = uniqueId('idem-key');
  const firstPayload = JSON.stringify({
    items: [{ productId: DEMO_PRODUCTS.galaxyS24Blue, quantity: 1 }]
  });
  const divergentPayload = JSON.stringify({
    items: [{ productId: DEMO_PRODUCTS.galaxyS24Blue, quantity: 2 }]
  });
  const headers = jsonHeaders({
    'X-Customer-Id': customerId,
    'Idempotency-Key': key
  });

  const first = http.post(`${BASE_URL}/checkout`, firstPayload, headers);
  const replay = http.post(`${BASE_URL}/checkout`, firstPayload, headers);
  const conflict = http.post(`${BASE_URL}/checkout`, divergentPayload, headers);

  check(first, {
    'first request accepted': (r) => r.status === 202 || r.status === 200
  });
  check(replay, {
    'same payload returns replay': (r) => r.status === 200
  });
  check(conflict, {
    'different payload returns conflict': (r) => r.status === 409
  });
}
```

- [ ] **Step 2: Run after resetting demo data**

Run:

```bash
npm run seed:demo
curl -X POST http://localhost:3000/admin/sync/erp
docker run --rm -e BASE_URL=http://host.docker.internal:3000 -v "$PWD/tests/k6:/scripts" grafana/k6 run /scripts/idempotency-retry.js
```

Expected: first request passes as `202` or replayable `200`, repeated payload returns `200`, divergent payload returns `409`.

- [ ] **Step 3: Commit**

```bash
git add tests/k6/idempotency-retry.js
git commit -m "test: cover k6 idempotency conflicts"
```

---

### Task 7: Wire NPM Scripts To Docker

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Replace K6 scripts**

In `package.json`, replace the existing K6 scripts with:

```json
{
  "k6:smoke": "docker run --rm -e BASE_URL=${BASE_URL:-http://host.docker.internal:3000} -v \"$PWD/tests/k6:/scripts\" grafana/k6 run /scripts/smoke.js",
  "k6:products": "docker run --rm -e BASE_URL=${BASE_URL:-http://host.docker.internal:3000} -v \"$PWD/tests/k6:/scripts\" grafana/k6 run /scripts/products-load.js",
  "k6:products-cache": "docker run --rm -e BASE_URL=${BASE_URL:-http://host.docker.internal:3000} -v \"$PWD/tests/k6:/scripts\" grafana/k6 run /scripts/products-cache.js",
  "k6:checkout": "docker run --rm -e BASE_URL=${BASE_URL:-http://host.docker.internal:3000} -v \"$PWD/tests/k6:/scripts\" grafana/k6 run /scripts/checkout-concurrency.js",
  "k6:idempotency": "docker run --rm -e BASE_URL=${BASE_URL:-http://host.docker.internal:3000} -v \"$PWD/tests/k6:/scripts\" grafana/k6 run /scripts/idempotency-retry.js"
}
```

Keep every non-K6 script unchanged.

- [ ] **Step 2: Validate package JSON**

Run:

```bash
npm pkg get scripts.k6:smoke scripts.k6:products scripts.k6:products-cache scripts.k6:checkout scripts.k6:idempotency
```

Expected: command exits `0` and prints the five Docker-backed script strings.

- [ ] **Step 3: Run smoke through npm**

Run:

```bash
npm run k6:smoke
```

Expected: Docker pulls `grafana/k6` if needed, then the smoke scenario passes against the prepared stack.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "test: run k6 scenarios through docker"
```

If `package-lock.json` does not change, omit it from `git add`.

---

### Task 8: Document Local K6 Workflow

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Replace existing K6 section**

Replace the current `## k6 Scenarios` section with:

````markdown
## K6 local scenarios

The K6 scripts run through Docker, so you do not need to install the `k6` binary on your machine. This avoids `sh: k6: command not found`.

Prepare the local stack and demo catalog:

```bash
docker compose up -d postgres redis rabbitmq
npm run build
npm run start:stack
npm run seed:demo
curl -X POST http://localhost:3000/admin/sync/erp
```

`seed:demo` and `seed:large` load the fake ERP in memory. The API reads catalog data from Postgres, so run `POST /admin/sync/erp` after seeding.

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

The Docker container reaches the host API through `http://host.docker.internal:3000` by default. Override it with:

```bash
BASE_URL=http://host.docker.internal:3000 npm run k6:products
```

If catalog tests return empty lists or `404` for demo products, reseed and sync again:

```bash
npm run seed:demo
curl -X POST http://localhost:3000/admin/sync/erp
```
````

- [ ] **Step 2: Validate README commands by running smoke**

Run:

```bash
npm run k6:smoke
```

Expected: smoke checks pass.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: document local k6 workflow"
```

---

### Task 9: Final Verification

**Files:**
- Read: `package.json`
- Read: `README.md`
- Run: K6 scripts

- [ ] **Step 1: Check worktree**

Run:

```bash
git status --short
```

Expected: only intentional user changes remain unstaged. Do not revert pre-existing changes in `README.md`, `docker-compose.yml`, `package.json`, or `rest-client.http`; work with them if they overlap.

- [ ] **Step 2: Run smoke and products scenarios**

Run:

```bash
npm run seed:demo
curl -X POST http://localhost:3000/admin/sync/erp
npm run k6:smoke
npm run k6:products
```

Expected: both K6 runs finish with passing checks and thresholds.

- [ ] **Step 3: Run checkout and idempotency scenarios after fresh seed**

Run:

```bash
npm run seed:demo
curl -X POST http://localhost:3000/admin/sync/erp
npm run k6:checkout
npm run seed:demo
curl -X POST http://localhost:3000/admin/sync/erp
npm run k6:idempotency
```

Expected: checkout has no `5xx`; idempotency replay and conflict checks pass.

- [ ] **Step 4: Run cache scenario**

Run:

```bash
npm run k6:products-cache
```

Expected: cache scenario checks pass.

- [ ] **Step 5: Final commit if verification required changes**

If any verification step required a fix, commit the fix:

```bash
git add README.md package.json tests/k6
git commit -m "test: finalize local k6 workflow"
```

If there are no changes after verification, do not create an empty commit.
