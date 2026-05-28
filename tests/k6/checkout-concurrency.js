import http from 'k6/http';
import { check } from 'k6';

export const options = {
  vus: 10,
  iterations: 20,
  thresholds: {
    http_req_failed: ['rate<0.05']
  }
};

export default function () {
  const baseUrl = __ENV.BASE_URL || 'http://localhost:3000';
  const customerId = `customer-${Math.random().toString(36).slice(2, 10)}`;
  const response = http.post(
    `${baseUrl}/checkout`,
    JSON.stringify({
      items: [{ productId: 'prod-hot', quantity: 1 }]
    }),
    {
      headers: {
        'Content-Type': 'application/json',
        'X-Customer-Id': customerId,
        'Idempotency-Key': `${customerId}-${__ITER}`
      }
    }
  );

  check(response, {
    'status is accepted or conflict': (r) => r.status === 202 || r.status === 409
  });
}
