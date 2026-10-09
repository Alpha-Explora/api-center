import { Pool } from 'pg';
import type { GauthEnvironment, OAuthAppRecord, OAuthAppStore } from './oauth-app-store';

interface OAuthAppRow {
  project_id: string;
  environment: GauthEnvironment;
  redirect_uris: string[];
  client_id: string | null;
  client_secret_ref: string | null;
  client_secret_updated_at: Date | string | null;
  display_name: string;
  status: 'active' | 'disabled';
}

export class PostgresOAuthAppStore implements OAuthAppStore {
  private readonly pool: Pool;

  constructor(connectionString: string) {
    this.pool = new Pool({
      connectionString,
      max: 5,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined,
    });
  }

  async findByProjectAndEnvironment(projectId: string, environment: GauthEnvironment): Promise<OAuthAppRecord | null> {
    const result = await this.pool.query<OAuthAppRow>(
      `select project_id, environment, redirect_uris, client_id, client_secret_ref,
              client_secret_updated_at, display_name, status
         from shared_gauth.oauth_apps
        where project_id = $1 and environment = $2`,
      [projectId, environment],
    );
    const row = result.rows[0];
    if (!row) {
      return null;
    }
    return {
      projectId: row.project_id,
      environment: row.environment,
      redirectUris: [...row.redirect_uris],
      clientId: row.client_id,
      clientSecretRef: row.client_secret_ref,
      clientSecretUpdatedAt: row.client_secret_updated_at
        ? new Date(row.client_secret_updated_at).toISOString()
        : null,
      displayName: row.display_name,
      status: row.status,
    };
  }

  async save(record: OAuthAppRecord): Promise<void> {
    await this.pool.query(
      `insert into shared_gauth.oauth_apps
         (project_id, environment, redirect_uris, client_id, client_secret_ref,
          client_secret_updated_at, display_name, status)
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       on conflict (project_id, environment) do update set
         redirect_uris = excluded.redirect_uris,
         client_id = excluded.client_id,
         client_secret_ref = excluded.client_secret_ref,
         client_secret_updated_at = excluded.client_secret_updated_at,
         display_name = excluded.display_name,
         status = excluded.status,
         updated_at = now()`,
      [record.projectId, record.environment, record.redirectUris, record.clientId,
       record.clientSecretRef, record.clientSecretUpdatedAt ?? null, record.displayName, record.status],
    );
  }

  async delete(projectId: string, environment: GauthEnvironment): Promise<void> {
    await this.pool.query(
      `delete from shared_gauth.oauth_apps where project_id = $1 and environment = $2`,
      [projectId, environment],
    );
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
