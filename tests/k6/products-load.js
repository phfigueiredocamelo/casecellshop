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
