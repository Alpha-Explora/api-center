import { ExecutionContext } from '@nestjs/common';
import { JwtAuthGuard } from './jwt-auth.guard';
import { AuthService } from '../auth.service';
import { LoggerService } from '../../shared/logger.service';
import { UnauthorizedError } from '../../shared/errors';

function createContext(request: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as unknown as ExecutionContext;
}

describe('JwtAuthGuard', () => {
  const mockAuth = {
    validateToken: jest.fn(),
  } as unknown as AuthService;

  const mockLogger = {
    warn: jest.fn(),
  } as unknown as LoggerService;

  let guard: JwtAuthGuard;

  beforeEach(() => {
    jest.clearAllMocks();
    guard = new JwtAuthGuard(mockAuth, mockLogger);
  });

  it('should reject requests without an authorization token', async () => {
    const request = { headers: {}, ip: '127.0.0.1', path: '/api/v1/tribes' };

    await expect(guard.canActivate(createContext(request))).rejects.toThrow(UnauthorizedError);
  });

  it('should attach claims and tribe identity when token is valid', async () => {
    const request: Record<string, unknown> = {
      headers: { authorization: 'Bearer valid-token' },
      ip: '127.0.0.1',
      path: '/api/v1/tribes',
    };
    (mockAuth.validateToken as jest.Mock).mockResolvedValue({
      sub: 'svc-alpha',
      tribeId: 'svc-alpha',
      scopes: ['scope:read'],
      permissions: [],
    });

    const allowed = await guard.canActivate(createContext(request));

    expect(allowed).toBe(true);
    expect(request.user).toEqual(expect.objectContaining({ sub: 'svc-alpha' }));
    expect(request.tribeId).toBe('svc-alpha');
  });

  it('should reject invalid tokens and emit guard warning', async () => {
    const request = {
      headers: { authorization: 'Bearer invalid-token' },
      ip: '127.0.0.1',
      path: '/api/v1/tribes',
    };
    (mockAuth.validateToken as jest.Mock).mockRejectedValue(new Error('invalid-token'));

    await expect(guard.canActivate(createContext(request))).rejects.toThrow(UnauthorizedError);
    expect(mockLogger.warn).toHaveBeenCalled();
  });
});
