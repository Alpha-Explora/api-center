import type { Request, Response } from 'express';
import { fail, ok } from '@apicenter/runtime';
import { GauthVerifyTokenRequest } from '@alpha-explora/apicenter-contracts';
import { VerifyTokenContext, VerifyTokenService } from './verify-token.service';

type VerifyTokenHandlerService = {
  execute(input: GauthVerifyTokenRequest, context: VerifyTokenContext): Promise<unknown>;
};

export function createVerifyTokenRouteHandler(service: VerifyTokenHandlerService) {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      // The gateway removes caller-supplied identity headers and sets these from the
      // authenticated service token. Never accept project, environment, or audience in the body.
      const result = await service.execute(req.body as GauthVerifyTokenRequest, {
        projectId: req.header('X-APICenter-Project-Id'),
        environment: req.header('X-APICenter-Environment'),
      });
      ok(res, result);
    } catch (err: any) {
      if (Number.isInteger(err?.status) && typeof err?.code === 'string' && typeof err?.message === 'string') {
        fail(res, err.status, err.code, err.message);
      } else {
        fail(res, 500, 'GAUTH_VERIFICATION_FAILED', 'Google ID token verification could not be completed.');
      }
    }
  };
}
