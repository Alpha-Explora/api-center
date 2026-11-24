import { createHash, timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import type { SmsRepositoryInterface } from './sms-repository.interface';
import { isValidSmsSenderId } from './project-sender';

/** GET reads, PUT pins and DELETE clears one project environment's SMS sender ID. */
export function createSmsSenderAdminHandler(deps: {
  store: SmsRepositoryInterface;
  expectedToken: string | undefined;
  /** Whether the platform has its own sender for projects that pin none. */
  platformSenderConfigured: boolean;
}) {
  return async (req: Request, res: Response): Promise<void> => {
    if (!tokenMatches(req.header('X-APICenter-Sms-Admin-Token') || undefined, deps.expectedToken)) {
      res.status(401).json({ error: 'UNAUTHORIZED', message: 'SMS admin token is invalid.' });
      return;
    }
    const projectId = typeof req.params.projectId === 'string' ? req.params.projectId : undefined;
    const environment = req.params.environment;
    if (!projectId || !/^[A-Za-z0-9_-]{1,200}$/.test(projectId) || (environment !== 'test' && environment !== 'live')) {
      res.status(400).json({ error: 'INVALID_PROJECT_SENDER', message: 'Project or environment is invalid.' });
      return;
    }

    let senderId: string | null;
    if (req.method === 'GET' || req.method === 'DELETE') {
      senderId = null;
    } else if (req.method === 'PUT') {
      const raw = req.body?.senderId;
      senderId = typeof raw === 'string' ? raw.trim() : '';
      if (!isValidSmsSenderId(senderId)) {
        res.status(400).json({
          error: 'INVALID_PROJECT_SENDER',
          message: 'senderId must be an E.164 phone number or 1–11 letters, digits or spaces with at least one letter.',
        });
        return;
      }
    } else {
      res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
      return;
    }

    try {
      const record = req.method === 'GET'
        ? await deps.store.getProjectSender(projectId, environment)
        : await deps.store.setProjectSender({ projectId, environment, senderId });
      const pinned = record?.senderId ?? null;
      res.status(200).json({
        projectId,
        environment,
        configured: pinned !== null,
        senderId: pinned,
        platformSenderConfigured: deps.platformSenderConfigured,
      });
    } catch {
      res.status(503).json({ error: 'PROJECT_SENDER_UNAVAILABLE', message: 'Project SMS sender settings are unavailable.' });
    }
  };
}

function tokenMatches(candidate: string | undefined, expected: string | undefined): boolean {
  if (!candidate || !expected) return false;
  const candidateHash = createHash('sha256').update(candidate).digest();
  const expectedHash = createHash('sha256').update(expected).digest();
  return timingSafeEqual(candidateHash, expectedHash);
}
