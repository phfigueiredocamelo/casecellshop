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
  const requestOptions = {
    ...jsonHeaders({
      'X-Customer-Id': customerId,
      'Idempotency-Key': idempotencyKey
    }),
    responseCallback: http.expectedStatuses(202, 409, 422)
  };
  const response = http.post(
    `${BASE_URL}/checkout`,
    JSON.stringify({
      items: [{ productId: DEMO_PRODUCTS.iphone15Clear, quantity: 1 }]
    }),
    requestOptions
  );

  check(response, {
    'checkout returns expected status': (r) => [202, 409, 422].includes(r.status),
    'checkout does not return 5xx': (r) => r.status < 500
  });

  sleep(0.1);
}
