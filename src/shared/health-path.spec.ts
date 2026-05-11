import { isHealthCheckPath } from './health-path';

describe('isHealthCheckPath', () => {
  it('matches global-prefixed health routes', () => {
    expect(isHealthCheckPath('/api/v1/health/live')).toBe(true);
    expect(isHealthCheckPath('/api/v1/health/ready?probe=gclb')).toBe(true);
  });

  it('matches local health routes before global prefixing', () => {
    expect(isHealthCheckPath('/health/live')).toBe(true);
    expect(isHealthCheckPath('/health/ready')).toBe(true);
  });

  it('does not match unrelated routes', () => {
    expect(isHealthCheckPath('/api/v1/tribes/health-service/status')).toBe(false);
    expect(isHealthCheckPath('/api/v1/registry/scopes')).toBe(false);
  });
});

