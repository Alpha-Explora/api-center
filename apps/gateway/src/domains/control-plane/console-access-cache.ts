// Remembers console access decisions for a few seconds. A console page starts about a dozen gateway
// requests at once, and each one checked the caller's roles in its own database transaction before
// doing any work. Roles are cached for ACCESS_TTL_MS and dropped on this instance as soon as
// organization people change; another instance can act on a removed role for at most that long.
// Projects never move between organizations, so a project's organization is kept until restart.

import type { MemberAccess } from "./console-access.policy";

export const ACCESS_TTL_MS = 10_000;
const MAX_ENTRIES = 10_000;

export class ConsoleAccessCache {
  private readonly access = new Map<string, { value: MemberAccess; organizationId: string; expiresAt: number }>();
  private readonly projectOrganizations = new Map<string, string>();

  getAccess(organizationId: string, email: string, subject: string, now = Date.now()): MemberAccess | undefined {
    const key = accessKey(organizationId, email, subject);
    const entry = this.access.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= now) {
      this.access.delete(key);
      return undefined;
    }
    return entry.value;
  }

  setAccess(organizationId: string, email: string, subject: string, value: MemberAccess, now = Date.now()): void {
    if (this.access.size >= MAX_ENTRIES) this.access.clear();
    this.access.set(accessKey(organizationId, email, subject), { value, organizationId, expiresAt: now + ACCESS_TTL_MS });
  }

  /** Call after any change to an organization's members, teams or project roles. */
  invalidateOrganization(organizationId: string): void {
    for (const [key, entry] of this.access) {
      if (entry.organizationId === organizationId) this.access.delete(key);
    }
  }

  projectBelongsTo(projectId: string, organizationId: string): boolean {
    return this.projectOrganizations.get(projectId) === organizationId;
  }

  rememberProject(projectId: string, organizationId: string): void {
    if (this.projectOrganizations.size >= MAX_ENTRIES) this.projectOrganizations.clear();
    this.projectOrganizations.set(projectId, organizationId);
  }
}

function accessKey(organizationId: string, email: string, subject: string): string {
  return `${organizationId}\n${email}\n${subject}`;
}

const caches = new WeakMap<object, ConsoleAccessCache>();

/** One cache per database client: production has one, and each test's fake database gets its own. */
export function consoleAccessCacheFor(database: object): ConsoleAccessCache {
  let cache = caches.get(database);
  if (!cache) {
    cache = new ConsoleAccessCache();
    caches.set(database, cache);
  }
  return cache;
}
