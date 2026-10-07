import { IdempotencyInterceptor } from './idempotency.interceptor.js';

describe('IdempotencyInterceptor', () => {
  it('should be defined', () => {
    expect(new IdempotencyInterceptor()).toBeDefined();
  });
});
