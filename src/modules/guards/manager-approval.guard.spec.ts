import { ManagerApprovalGuard } from './manager-approval.guard.js';

describe('ManagerApprovalGuard', () => {
  it('should be defined', () => {
    expect(new ManagerApprovalGuard()).toBeDefined();
  });
});
