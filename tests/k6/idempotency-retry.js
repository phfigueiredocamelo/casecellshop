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
  const requestOptions = {
    ...jsonHeaders({
      'X-Customer-Id': customerId,
      'Idempotency-Key': key
    }),
    responseCallback: http.expectedStatuses(200, 202, 409)
  };

  const first = http.post(`${BASE_URL}/checkout`, firstPayload, requestOptions);
  const replay = http.post(`${BASE_URL}/checkout`, firstPayload, requestOptions);
  const conflict = http.post(`${BASE_URL}/checkout`, divergentPayload, requestOptions);

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
