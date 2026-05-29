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
