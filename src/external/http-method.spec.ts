import { normalizeHttpMethod } from './http-method';

describe('normalizeHttpMethod', () => {
  it('normalizes supported methods to uppercase', () => {
    expect(normalizeHttpMethod('get')).toBe('GET');
    expect(normalizeHttpMethod('POST')).toBe('POST');
    expect(normalizeHttpMethod('patch')).toBe('PATCH');
  });

  it('rejects unsupported methods', () => {
    expect(() => normalizeHttpMethod('TRACE')).toThrow('Unsupported HTTP method');
  });
});

