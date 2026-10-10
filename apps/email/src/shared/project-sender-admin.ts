import { createHash, timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import type { EmailRepositoryInterface } from './email-repository.interface';

export function createProjectSenderAdminHandler(deps: {
  store: EmailRepositoryInterface;
  expectedToken: string | undefined;
}) {
  return async (req: Request, res: Response): Promise<void> => {
    const candidate = req.header('X-APICenter-Email-Admin-Token') || undefined;
    if (!tokenMatches(candidate, deps.expectedToken)) {
      res.status(401).json({ error: 'UNAUTHORIZED', message: 'Email admin token is invalid.' });
      return;
    }
    const projectParam = req.params.projectId;
    const projectId = typeof projectParam === 'string' ? projectParam : undefined;
    const environment = req.params.environment;
    if (!projectId || !/^[A-Za-z0-9_-]{1,200}$/.test(projectId) || (environment !== 'test' && environment !== 'live')) {
      res.status(400).json({ error: 'INVALID_PROJECT_SENDER', message: 'Project or environment is invalid.' });
      return;
    }
    const body = req.body;
    const fromAddress = body && typeof body.fromAddress === 'string' ? body.fromAddress.trim() : '';
    const dailyLimit = body?.dailyLimit === undefined ? null : body.dailyLimit;
    if (!fromAddress || fromAddress.length > 320 || /[\r\n]/.test(fromAddress) ||
      (dailyLimit !== null && (!Number.isSafeInteger(dailyLimit) || dailyLimit < 1))) {
      res.status(400).json({ error: 'INVALID_PROJECT_SENDER', message: 'Provide a valid fromAddress and a positive dailyLimit or null.' });
      return;
    }
    try {
      const record = await deps.store.setProjectSender({ projectId, environment, fromAddress, dailyLimit });
      res.status(200).json(record);
    } catch {
      res.status(503).json({ error: 'PROJECT_SENDER_UNAVAILABLE', message: 'Project email sender settings could not be saved.' });
    }
  };
}

function tokenMatches(candidate: string | undefined, expected: string | undefined): boolean {
  if (!candidate || !expected) return false;
  const candidateHash = createHash('sha256').update(candidate).digest();
  const expectedHash = createHash('sha256').update(expected).digest();
  return timingSafeEqual(candidateHash, expectedHash);
}
