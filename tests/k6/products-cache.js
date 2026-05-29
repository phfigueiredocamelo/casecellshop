import http from 'k6/http';
import { check, sleep } from 'k6';
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
  http.get(`${BASE_URL}${catalogPath}`);
  http.get(`${BASE_URL}/products/${DEMO_PRODUCTS.iphone15Clear}`);
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
