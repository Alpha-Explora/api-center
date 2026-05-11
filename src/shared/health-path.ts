export function isHealthCheckPath(path?: string): boolean {
  const normalizedPath = (path || '').split('?')[0];

  return (
    normalizedPath === '/health' ||
    normalizedPath.startsWith('/health/') ||
    normalizedPath === '/api/v1/health' ||
    normalizedPath.startsWith('/api/v1/health/')
  );
}

