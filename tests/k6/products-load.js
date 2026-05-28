import http from 'k6/http';
import { check } from 'k6';

export const options = {
  vus: 20,
  duration: '30s',
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<300']
  }
};

export default function () {
  const baseUrl = __ENV.BASE_URL || 'http://localhost:3000';
  const response = http.get(
    `${baseUrl}/products?device=apple-iphone-15&sort=relevance&page=1&pageSize=24`
  );

  check(response, {
    'status 200': (r) => r.status === 200
  });
}
