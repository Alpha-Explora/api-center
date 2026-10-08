/**
 * One-shot cutover to the tribe -> project -> service hierarchy for registries persisted in Redis.
 * Postgres registries are migrated by supabase/migrations/20261008000000_tribe_project_hierarchy.sql;
 * run this as well when Redis is the registry source or when dual-write keeps a Redis copy.
 *
 * Rules (identical to the SQL migration):
 *   - one tribe per distinct owner: ownerTribeId, or serviceId for legacy tribe roots;
 *   - one "<tribe>-default" project per tribe holding every existing service of that tribe;
 *   - shared services get no project.
 *
 * Usage:
 *   npx ts-node scripts/migrate-tenancy-hierarchy.ts                  # dry run: prints the plan
 *   npx ts-node scripts/migrate-tenancy-hierarchy.ts --apply --copy-secrets
 *       writes tenancy and updated entries after giving each tribe service its own Secret Manager secret
 *       (<TRIBE_SECRET_GCP_PREFIX or api-center-service-secret-><serviceId>-<env>) carrying the hashes of its
 *       tribe's old secret (<--old-prefix, default api-center-tribe-secret-><tribeId>-<env>), so existing clients
 *       keep their plaintext secret; rotate each service afterwards.
 *   npx ts-node scripts/migrate-tenancy-hierarchy.ts --apply --no-secrets
 *       explicit opt-out for environments where service secrets are provisioned separately.
 *
 * Env: REDIS_CACHE_URL (default redis://localhost:6381), GCP_PROJECT_ID for --copy-secrets.
 */
import Redis from "ioredis";
import { SecretManagerServiceClient } from "@google-cloud/secret-manager";

const REGISTRY_KEY = "api-center:registry:services";
const TRIBES_KEY = "api-center:tenancy:tribes";
const PROJECTS_KEY = "api-center:tenancy:projects";
const TRIBE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const PROJECT_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,79}$/;

type Entry = {
  serviceId: string;
  name?: string;
  serviceType?: "tribe" | "shared";
  projectId?: string;
  ownerTribeId?: string;
  environments?: Array<{ environment: string }>;
  [key: string]: unknown;
};

const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");
const copySecrets = args.has("--copy-secrets");
const noSecrets = args.has("--no-secrets");
const oldPrefix = readArg("--old-prefix") ?? "api-center-tribe-secret-";
const newPrefix = process.env.TRIBE_SECRET_GCP_PREFIX || "api-center-service-secret-";

function readArg(name: string): string | undefined {
  const raw = process.argv.find((arg) => arg.startsWith(name + "="));
  return raw ? raw.slice(name.length + 1) : undefined;
}

async function main(): Promise<void> {
  const redis = new Redis(process.env.REDIS_CACHE_URL || "redis://localhost:6381", { lazyConnect: true });
  await redis.connect();
  try {
    const raw = await redis.hgetall(REGISTRY_KEY);
    const entries = Object.values(raw).map((json) => JSON.parse(json) as Entry);
    const existingTribeRows = await redis.hgetall(TRIBES_KEY);
    const existingTribes = new Map(
      Object.entries(existingTribeRows).map(([tribeId, json]) => [
        tribeId,
        JSON.parse(json) as { tribeId?: string },
      ]),
    );
    const existingProjectRows = await redis.hgetall(PROJECTS_KEY);
    const existingProjects = new Map(
      Object.entries(existingProjectRows).map(([projectId, json]) => [
        projectId,
        JSON.parse(json) as { projectId?: string; tribeId?: string },
      ]),
    );
    const now = new Date().toISOString();
    const tribes = new Map<string, { tribeId: string; name: string }>();
    const defaultProjects = new Map<string, { projectId: string; tribeId: string; name: string }>();
    const updates: Entry[] = [];
    const secretCandidates: Entry[] = [];
    const problems: string[] = [];

    for (const entry of entries) {
      if ((entry.serviceType ?? "tribe") === "shared") {
        if (entry.projectId !== undefined || entry.ownerTribeId !== undefined) {
          const sharedEntry = { ...entry };
          delete sharedEntry.projectId;
          delete sharedEntry.ownerTribeId;
          updates.push(sharedEntry);
        }
        continue;
      }
      const tribeId = entry.ownerTribeId ?? entry.serviceId;
      if (!TRIBE_ID_PATTERN.test(tribeId)) {
        problems.push(`${entry.serviceId}: owner '${tribeId}' is not a valid tribe id`);
        continue;
      }
      const projectId = entry.projectId ?? `${tribeId}-default`;
      if (!PROJECT_ID_PATTERN.test(projectId)) {
        problems.push(`${entry.serviceId}: project '${projectId}' is not a valid project id`);
        continue;
      }
      const rootName = entries.find((candidate) => candidate.serviceId === tribeId)?.name;
      const existingTribe = existingTribes.get(tribeId);
      if (existingTribe && existingTribe.tribeId !== tribeId) {
        problems.push(`${entry.serviceId}: existing Tribe record '${tribeId}' has a conflicting identity`);
      }
      tribes.set(tribeId, { tribeId, name: rootName ?? tribeId });
      if (projectId === `${tribeId}-default`) {
        const existing = existingProjects.get(projectId);
        if (existing && (existing.projectId !== projectId || existing.tribeId !== tribeId)) {
          problems.push(`${entry.serviceId}: existing project '${projectId}' has a conflicting identity or Tribe`);
        }
        defaultProjects.set(projectId, { projectId, tribeId, name: rootName ?? tribeId });
      } else {
        const existing = existingProjects.get(projectId);
        if (!existing || existing.projectId !== projectId || existing.tribeId !== tribeId) {
          problems.push(
            `${entry.serviceId}: existing project '${projectId}' is missing or belongs to another tribe; repair the project record before migration`,
          );
        }
      }
      const placedEntry = { ...entry, ownerTribeId: tribeId, projectId };
      if (entry.ownerTribeId !== tribeId || entry.projectId !== projectId) updates.push(placedEntry);
      secretCandidates.push(placedEntry);
    }

    console.log(`Tribes to ensure: ${tribes.size}`);
    for (const tribe of tribes.values()) console.log(`  ${tribe.tribeId}`);
    console.log(`Default projects to ensure: ${defaultProjects.size}`);
    for (const project of defaultProjects.values()) console.log(`  ${project.projectId} -> tribe ${project.tribeId}`);
    console.log(`Service placements to update: ${updates.length}`);
    for (const update of updates) console.log(`  ${update.serviceId} -> ${update.projectId}`);
    if (problems.length > 0) {
      console.error("Blocking problems (nothing written):");
      for (const problem of problems) console.error("  " + problem);
      process.exitCode = 1;
      return;
    }
    if (!apply) {
      console.log("Dry run. Re-run with --apply to write.");
      return;
    }
    if (copySecrets && noSecrets) {
      throw new Error("Choose either --copy-secrets or --no-secrets, not both");
    }
    if (!copySecrets && !noSecrets && secretCandidates.some(hasEnvironmentCredential)) {
      throw new Error(
        "Refusing to move registry services without credentials. Use --copy-secrets, or explicitly opt out with --no-secrets when credentials are provisioned separately.",
      );
    }

    // Copy credentials before publishing the new placements. Redis and Secret
    // Manager cannot share a transaction, so a credential-copy failure must
    // leave the registry on its old placement.
    if (copySecrets) await copyTribeSecrets(secretCandidates);

    const pipeline = redis.multi();
    for (const tribe of tribes.values()) {
      pipeline.hsetnx(TRIBES_KEY, tribe.tribeId, JSON.stringify({ ...tribe, status: "active", createdAt: now, updatedAt: now }));
    }
    for (const project of defaultProjects.values()) {
      pipeline.hsetnx(
        PROJECTS_KEY,
        project.projectId,
        JSON.stringify({
          ...project,
          description: "Default project created by the tribe/project hierarchy migration",
          status: "active",
          createdAt: now,
          updatedAt: now,
        }),
      );
    }
    for (const update of updates) pipeline.hset(REGISTRY_KEY, update.serviceId, JSON.stringify(update));
    const results = await pipeline.exec();
    if (!results) throw new Error("Redis did not execute the hierarchy migration transaction");
    const commandErrors = results.flatMap(([error], index) =>
      error ? [`command ${index + 1}: ${error.message}`] : [],
    );
    if (commandErrors.length > 0) {
      throw new Error(`Redis hierarchy migration reported errors: ${commandErrors.join("; ")}`);
    }
    console.log("Redis tenancy and registry entries written. Restart gateway instances to reload.");
  } finally {
    await redis.quit();
  }
}

function hasEnvironmentCredential(service: Entry): boolean {
  return service.environments?.some((row) => row.environment === "test" || row.environment === "live") ?? false;
}

async function copyTribeSecrets(services: Entry[]): Promise<void> {
  const projectId = process.env.GCP_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT;
  if (!projectId) throw new Error("GCP_PROJECT_ID is required for --copy-secrets");
  const client = new SecretManagerServiceClient();

  for (const service of services) {
    for (const environment of ["test", "live"]) {
      if (!service.environments?.some((row) => row.environment === environment)) continue;
      const source = `projects/${projectId}/secrets/${oldPrefix}${service.ownerTribeId}-${environment}`;
      const targetId = `${newPrefix}${service.serviceId}-${environment}`;
      const target = `projects/${projectId}/secrets/${targetId}`;

      let targetExists = false;
      try {
        const [targetSecret] = await client.getSecret({ name: target });
        targetExists = true;
        try {
          const [existingVersion] = await client.accessSecretVersion({
            name: `${target}/versions/latest`,
          });
          const existingPayload = parseSecretPayload(
            Buffer.from(existingVersion.payload?.data ?? "").toString("utf8"),
            targetId,
          );
          if (
            existingPayload.serviceId !== service.serviceId ||
            existingPayload.environment !== environment
          ) {
            throw new Error(`Existing target ${targetId} has the wrong service or environment`);
          }
          validateCredentialPayload(existingPayload, targetId);
          console.log(`  keep ${targetId}: existing service credential verified`);
          continue;
        } catch (error) {
          if (!isSecretNotFound(error)) throw error;
          const labels = targetSecret?.labels ?? {};
          if (
            labels.apicenter_service !== service.serviceId ||
            labels.environment !== environment
          ) {
            throw new Error(
              `Existing target ${targetId} has no credential version and cannot be identified as a migration-created secret`,
            );
          }
          console.log(`  resume ${targetId}: migration-created secret has no version yet`);
        }
      } catch (error) {
        if (targetExists || !isSecretNotFound(error)) throw error;
      }

      let payload: Record<string, unknown>;
      try {
        const [version] = await client.accessSecretVersion({ name: `${source}/versions/latest` });
        payload = parseSecretPayload(
          Buffer.from(version.payload?.data ?? "").toString("utf8"),
          source,
        );
      } catch (error) {
        if (isSecretNotFound(error)) {
          throw new Error(`Cannot copy ${targetId}: no source credential at ${source}`);
        }
        throw error;
      }

      validateCredentialPayload(payload, source);
      if (String(payload.tribeId ?? "").trim().toLowerCase() !== service.ownerTribeId) {
        throw new Error(`Cannot copy ${targetId}: source ${source} belongs to a different tribe`);
      }
      if (payload.environment !== environment) {
        throw new Error(`Cannot copy ${targetId}: source ${source} belongs to '${String(payload.environment)}'`);
      }

      if (!targetExists) {
        await client.createSecret({
          parent: `projects/${projectId}`,
          secretId: targetId,
          secret: { replication: { automatic: {} }, labels: { apicenter_service: service.serviceId, environment } },
        });
      }

      const { tribeId: _tribeId, ...rest } = payload;
      await client.addSecretVersion({
        parent: target,
        payload: {
          data: Buffer.from(
            JSON.stringify({
              ...rest,
              serviceId: service.serviceId,
              environment,
              // Cleared automatically when the service secret is rotated, because rotation writes a fresh payload.
              migratedFromTribeSecret: true,
              migratedAt: new Date().toISOString(),
            }),
          ),
        },
      });
      console.log(`  wrote ${targetId} from ${source}`);
    }
  }
}

function parseSecretPayload(raw: string, resource: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Secret payload at ${resource} is not valid JSON`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Secret payload at ${resource} must be a JSON object`);
  }
  return parsed as Record<string, unknown>;
}

function validateCredentialPayload(payload: Record<string, unknown>, resource: string): void {
  if (!/^[a-f0-9]{64}$/i.test(String(payload.secretHashSha256 ?? ""))) {
    throw new Error(`Secret payload at ${resource} has no valid SHA-256 credential hash`);
  }
  if (payload.status && payload.status !== "active") {
    throw new Error(`Secret payload at ${resource} is not active`);
  }
}

function isSecretNotFound(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: unknown }).code === 5,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
