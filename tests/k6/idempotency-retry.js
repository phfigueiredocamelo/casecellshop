import http from 'k6/http';
import { check } from 'k6';

export const options = {
  vus: 5,
  iterations: 10,
  thresholds: {
    http_req_failed: ['rate<0.01']
  }
};

export default function () {
  const baseUrl = __ENV.BASE_URL || 'http://localhost:3000';
  const customerId = 'customer-idem';
  const key = 'idem-key-1';
  const payload = JSON.stringify({
    items: [{ productId: 'prod-1', quantity: 1 }]
  });

  const first = http.post(`${baseUrl}/checkout`, payload, {
    headers: {
      'Content-Type': 'application/json',
      'X-Customer-Id': customerId,
      'Idempotency-Key': key
    }
  });
  const second = http.post(`${baseUrl}/checkout`, payload, {
    headers: {
      'Content-Type': 'application/json',
      'X-Customer-Id': customerId,
      'Idempotency-Key': key
    }
  });

  check(first, {
    'first request accepted': (r) => r.status === 202 || r.status === 200
  });
  check(second, {
    'second request returns replay': (r) => r.status === 200
  });
}
