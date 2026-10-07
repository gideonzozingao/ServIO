import { PermissionGuard } from './permission.guard.js';

describe('PermissionGuard', () => {
  it('should be defined', () => {
    expect(new PermissionGuard()).toBeDefined();
  });
});
