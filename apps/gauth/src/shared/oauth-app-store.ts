import { PostgresOAuthAppStore } from './postgres-oauth-app-store';

export const GAUTH_ENVIRONMENTS = ['test', 'live'] as const;
export type GauthEnvironment = (typeof GAUTH_ENVIRONMENTS)[number];

export interface OAuthAppRecord {
  projectId: string;
  environment: GauthEnvironment;
  redirectUris: string[];
  clientId: string | null;
  clientSecretRef: string | null;
  displayName: string;
  status: 'active' | 'disabled';
}

export interface OAuthAppStore {
  findByProjectAndEnvironment(projectId: string, environment: GauthEnvironment): Promise<OAuthAppRecord | null>;
}

export function parseGauthEnvironment(value: unknown): GauthEnvironment | null {
  return typeof value === 'string' && (GAUTH_ENVIRONMENTS as readonly string[]).includes(value)
    ? (value as GauthEnvironment)
    : null;
}

function recordKey(projectId: string, environment: GauthEnvironment): string {
  return JSON.stringify([projectId, environment]);
}

function copyRecord(record: OAuthAppRecord): OAuthAppRecord {
  return { ...record, redirectUris: [...record.redirectUris] };
}

/** Keeps registrations in process memory. Used by tests and by local runs without a database. */
export class MemoryOAuthAppStore implements OAuthAppStore {
  private readonly records = new Map<string, OAuthAppRecord>();

  upsert(record: OAuthAppRecord): void {
    this.records.set(recordKey(record.projectId, record.environment), copyRecord(record));
  }

  async findByProjectAndEnvironment(projectId: string, environment: GauthEnvironment): Promise<OAuthAppRecord | null> {
    const record = this.records.get(recordKey(projectId, environment));
    return record ? copyRecord(record) : null;
  }
}

/** Postgres when GAUTH_DATABASE_URL or DATABASE_URL is set. Production refuses to start without one. */
export function createOAuthAppStore(env: Record<string, string | undefined> = process.env): OAuthAppStore {
  const connectionString = env.GAUTH_DATABASE_URL || env.DATABASE_URL;
  if (connectionString) {
    return new PostgresOAuthAppStore(connectionString);
  }
  if (env.NODE_ENV === 'production') {
    throw new Error('GAUTH_DATABASE_URL or DATABASE_URL is required in production.');
  }
  return new MemoryOAuthAppStore();
}
