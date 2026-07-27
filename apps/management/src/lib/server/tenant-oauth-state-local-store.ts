import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { TenantOAuthStateRecord } from "@/lib/tenant-oauth-lifecycle";

interface TenantOAuthStateStore {
  records: TenantOAuthStateRecord[];
}

export async function listTenantOAuthStateRecords(): Promise<TenantOAuthStateRecord[]> {
  const store = await readStore();
  return store.records;
}

export async function upsertTenantOAuthStateRecord(
  record: TenantOAuthStateRecord,
): Promise<TenantOAuthStateRecord> {
  const store = await readStore();
  const nextRecords = store.records.filter(
    (candidate) =>
      candidate.tenantSlug !== record.tenantSlug ||
      candidate.environment !== record.environment,
  );
  nextRecords.push(record);
  nextRecords.sort((left, right) =>
    `${left.tenantSlug}:${left.environment}`.localeCompare(`${right.tenantSlug}:${right.environment}`),
  );
  await writeStore({ records: nextRecords });
  return record;
}

async function readStore(): Promise<TenantOAuthStateStore> {
  try {
    const raw = await readFile(getStorePath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<TenantOAuthStateStore>;
    return {
      records: Array.isArray(parsed.records)
        ? parsed.records.filter(isRecord)
        : [],
    };
  } catch {
    return { records: [] };
  }
}

async function writeStore(store: TenantOAuthStateStore): Promise<void> {
  const filePath = getStorePath();
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
}

function getStorePath(): string {
  return path.resolve(process.cwd(), ".local-state/tenant-oauth-states.json");
}

function isRecord(value: unknown): value is TenantOAuthStateRecord {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.tenantSlug === "string" &&
    typeof candidate.environment === "string" &&
    typeof candidate.status === "string" &&
    typeof candidate.displayName === "string" &&
    typeof candidate.authProjectId === "string" &&
    typeof candidate.secretName === "string" &&
    typeof candidate.redirectUri === "string" &&
    typeof candidate.allowSharedOauthFallback === "boolean" &&
    typeof candidate.updatedAt === "string"
  );
}
