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
