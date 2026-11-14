// Plans the migration of one organization's legacy tribes, projects and services into the control
// plane. Pure: the caller supplies a snapshot read through the legacy contexts' public services.
//
// Rules (approved design, "Migration and rollback"):
// - Each legacy project becomes an organization-owned project; its tribe becomes an optional team
//   with no inferred members, so console access is never enlarged.
// - Each legacy service environment becomes an application. A service that exposes routes also
//   becomes a published API in that environment.
// - Grants snapshot the legacy effective access (registry access rule plus scope check) against a
//   fixed catalog revision. Nothing is widened: anything unrepresentable is a blocker.
// - Records stay owned by the legacy (tribe, project) through a resource-owner mapping.
// - Plans, project quotas and tribe ceilings carry over; a tribe ceiling becomes a shared ceiling
//   over exactly that tribe's migrated projects.

import { createHash } from "node:crypto";
import { isValidPathPattern } from "../api-operations";
import { listCapabilities } from "../capability-catalog";

export type Kind = "test" | "live";

export interface LegacyService {
  serviceId: string;
  name: string;
  serviceType: "tribe" | "shared";
  projectId?: string;
  ownerTribeId?: string;
  status: string;
  requiredScopes: string[];
  exposes: string[];
  environments: { environment: Kind; baseUrl: string; status?: string }[];
}

export interface LegacySnapshot {
  organizationId: string;
  tribes: { tribeId: string; name: string; status: string }[];
  projects: { projectId: string; tribeId: string; name: string; status: string }[];
  /** Every registered service, including other organizations' and shared ones (targets). */
  services: LegacyService[];
  /** Legacy registry decision: may source call target in this environment (route-level rule). */
  canAccess: (sourceServiceId: string, targetServiceId: string, environment: Kind) => boolean;
  /** Scopes a token minted for the source would carry (union over its callable targets). */
  tokenScopes: (sourceServiceId: string) => string[];
  paymentConsumers: { ownerTribeId: string; consumerServiceId: string; environment: Kind; status: string; scopes: string[] }[];
  planAssignments: { ownerTribeId: string; projectId: string; environment: Kind; planKey: string; status: string }[];
  quotaPolicies: {
    id: string;
    ownerTribeId: string;
    projectId: string | null;
    scope: string;
    targetServiceId: string | null;
    windowSeconds: number;
    maxRequests: number;
    burstRequests: number | null;
    mode: string;
    status: string;
  }[];
  merchantBound: boolean;
}

export interface PlannedGrant {
  targetKind: "capability" | "api";
  /** Capability ID, or the legacy service ID whose published API is the target. */
  target: string;
  action: string;
}

export interface PlannedApplication {
  legacyServiceId: string;
  slug: string;
  name: string;
  grants: PlannedGrant[];
}

export interface PlannedApi {
  legacyServiceId: string;
  slug: string;
  name: string;
  upstreamUrl: string;
  action: string;
  operations: { method: string; path: string; action: string }[];
}

export interface PlannedEnvironment {
  kind: Kind;
  applications: PlannedApplication[];
  apis: PlannedApi[];
  capabilities: string[];
  planKey?: string;
  quotaPolicies: { legacyPolicyId: string; capability: string | null; windowSeconds: number; maxRequests: number; mode: "observe" | "enforce" }[];
}

export interface PlannedProject {
  legacyProjectId: string;
  tribeId: string;
  slug: string;
  name: string;
  environments: PlannedEnvironment[];
}

export interface MigrationPlan {
  organizationId: string;
  catalogRevision: string;
  teams: { tribeId: string; slug: string; name: string }[];
  projects: PlannedProject[];
  sharedCeilings: { legacyPolicyId: string; tribeId: string; environmentKind: Kind; legacyProjectIds: string[]; windowSeconds: number; maxRequests: number; mode: "observe" | "enforce" }[];
  blockers: { legacyId: string; reason: string }[];
  approximations: { legacyId: string; note: string }[];
}

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];
const KINDS: Kind[] = ["test", "live"];

export function catalogRevision(): string {
  return digest(listCapabilities()).slice(0, 16);
}

export function planDigest(plan: MigrationPlan): string {
  return digest(plan);
}

export function slugify(value: string): string {
  const slug = value.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64).replace(/-+$/g, "");
  return slug || "migrated";
}

/** Legacy `/orders/:id` → `/orders/{id}`; undefined when not representable. */
export function legacyRouteToPattern(route: string): string | undefined {
  const path = route.trim().split(/\s+/).pop() ?? "";
  const converted = path.replace(/:([A-Za-z][A-Za-z0-9_]*)/g, "{$1}");
  return isValidPathPattern(converted) ? converted : undefined;
}

function active(status: string | undefined) {
  return !status || status === "active";
}

export function planMigration(snapshot: LegacySnapshot): MigrationPlan {
  const blockers: MigrationPlan["blockers"] = [];
  const approximations: MigrationPlan["approximations"] = [];
  const capabilities = new Map(listCapabilities().map((capability) => [capability.id, capability.actions.map((entry) => entry.action)]));
  const tribes = snapshot.tribes.filter((tribe) => active(tribe.status));
  const tribeIds = new Set(tribes.map((tribe) => tribe.tribeId));
  const projects = snapshot.projects.filter((project) => tribeIds.has(project.tribeId) && active(project.status));
  const projectIds = new Set(projects.map((project) => project.projectId));
  const servicesById = new Map(snapshot.services.map((service) => [service.serviceId, service]));
  const owned = snapshot.services.filter(
    (service) => service.serviceType === "tribe" && service.projectId && projectIds.has(service.projectId) && service.status !== "retired",
  );

  for (const service of owned) {
    const project = projects.find((candidate) => candidate.projectId === service.projectId)!;
    if (service.ownerTribeId && service.ownerTribeId !== project.tribeId) {
      blockers.push({ legacyId: service.serviceId, reason: `owner tribe '${service.ownerTribeId}' does not match project tribe '${project.tribeId}'` });
    }
  }

  const usedSlugs = new Set<string>();
  const plannedProjects: PlannedProject[] = projects.map((project) => {
    let slug = slugify(project.projectId);
    while (usedSlugs.has(slug)) slug = `${slug.slice(0, 60)}-${usedSlugs.size}`;
    usedSlugs.add(slug);
    const services = owned.filter((service) => service.projectId === project.projectId);

    const environments: PlannedEnvironment[] = KINDS.flatMap((kind) => {
      const present = services.filter((service) => service.environments.some((environment) => environment.environment === kind && active(environment.status)));
      if (present.length === 0) return [];
      const capabilitiesUsed = new Set<string>();

      const apis: PlannedApi[] = present
        .filter((service) => service.exposes.length > 0)
        .flatMap((service) => {
          const patterns = service.exposes.map((route) => [route, legacyRouteToPattern(route)] as const);
          const invalid = patterns.filter(([, pattern]) => !pattern).map(([route]) => route);
          if (invalid.length) {
            blockers.push({ legacyId: service.serviceId, reason: `routes not representable as API operations: ${invalid.join(", ")}` });
            return [];
          }
          const upstreamUrl = service.environments.find((environment) => environment.environment === kind)!.baseUrl;
          const action = `${slugify(service.serviceId)}:call`;
          approximations.push({
            legacyId: service.serviceId,
            note: `legacy routing forwarded any path; the published API allows only its declared routes (${service.exposes.length}) for every method`,
          });
          return [
            {
              legacyServiceId: service.serviceId,
              slug: slugify(service.serviceId),
              name: service.name,
              upstreamUrl,
              action,
              operations: [...new Set(patterns.map(([, pattern]) => pattern as string))].flatMap((path) => METHODS.map((method) => ({ method, path, action }))),
            },
          ];
        });

      const applications: PlannedApplication[] = present.map((source) => {
        const grants: PlannedGrant[] = [];
        const scopes = new Set(snapshot.tokenScopes(source.serviceId));
        for (const target of snapshot.services) {
          if (target.serviceId === source.serviceId) continue;
          if (!target.environments.some((environment) => environment.environment === kind && active(environment.status))) continue;
          if (!snapshot.canAccess(source.serviceId, target.serviceId, kind)) continue;
          if (!target.requiredScopes.every((scope) => scopes.has(scope))) continue;

          if (target.serviceType === "shared") {
            const actions = capabilities.get(target.serviceId);
            if (!actions || target.serviceId === "payments") {
              if (target.serviceId !== "payments") {
                blockers.push({ legacyId: source.serviceId, reason: `access to shared service '${target.serviceId}' has no catalogued capability` });
              }
              continue;
            }
            capabilitiesUsed.add(target.serviceId);
            for (const action of actions) grants.push({ targetKind: "capability", target: target.serviceId, action });
            continue;
          }
          const targetService = servicesById.get(target.serviceId);
          if (!targetService?.projectId || !projectIds.has(targetService.projectId)) {
            blockers.push({ legacyId: source.serviceId, reason: `access to '${target.serviceId}' outside this organization cannot be granted` });
            continue;
          }
          if (targetService.exposes.length === 0) {
            blockers.push({ legacyId: source.serviceId, reason: `target '${target.serviceId}' declares no routes, so its access cannot be represented` });
            continue;
          }
          grants.push({ targetKind: "api", target: target.serviceId, action: `${slugify(target.serviceId)}:call` });
        }

        const consumer = snapshot.paymentConsumers.find(
          (entry) => entry.consumerServiceId === source.serviceId && entry.environment === kind && entry.ownerTribeId === project.tribeId && active(entry.status),
        );
        if (consumer) {
          if (!snapshot.merchantBound) {
            blockers.push({ legacyId: source.serviceId, reason: "payment consumer in an organization without a merchant binding" });
          } else {
            const all = consumer.scopes.some((scope) => scope === "*" || scope === "payments:*" || scope === "payments:write");
            const read = all || consumer.scopes.some((scope) => scope === "payments:read");
            for (const action of capabilities.get("payments") ?? []) {
              if (all || (read && action.endsWith(":read"))) grants.push({ targetKind: "capability", target: "payments", action });
            }
            capabilitiesUsed.add("payments");
          }
        }
        grants.sort((a, b) => `${a.targetKind}${a.target}${a.action}`.localeCompare(`${b.targetKind}${b.target}${b.action}`));
        return { legacyServiceId: source.serviceId, slug: slugify(source.serviceId), name: source.name, grants };
      });

      const assignment = snapshot.planAssignments.find(
        (entry) => entry.projectId === project.projectId && entry.ownerTribeId === project.tribeId && entry.environment === kind && entry.status === "active",
      );
      if (kind === "live" && !assignment) blockers.push({ legacyId: project.projectId, reason: "live environment has no active plan" });

      const quotaPolicies = snapshot.quotaPolicies
        .filter((policy) => policy.projectId === project.projectId && policy.ownerTribeId === project.tribeId && policy.status === "active")
        .flatMap((policy) => {
          let capability: string | null = null;
          if (policy.targetServiceId) {
            if (!capabilities.has(policy.targetServiceId)) {
              approximations.push({ legacyId: policy.id, note: `target-specific quota on '${policy.targetServiceId}' applies to all requests of the project` });
            } else {
              capability = policy.targetServiceId;
            }
          } else if (policy.scope !== "all") {
            approximations.push({ legacyId: policy.id, note: `'${policy.scope}' scope quota applies to all requests of the project` });
          }
          return [{
            legacyPolicyId: policy.id,
            capability,
            windowSeconds: policy.windowSeconds,
            maxRequests: policy.burstRequests ?? policy.maxRequests,
            mode: policy.mode === "enforce" ? ("enforce" as const) : ("observe" as const),
          }];
        });

      return [{ kind, applications, apis, capabilities: [...capabilitiesUsed].sort(), ...(assignment ? { planKey: assignment.planKey } : {}), quotaPolicies }];
    });

    return { legacyProjectId: project.projectId, tribeId: project.tribeId, slug, name: project.name, environments };
  });

  const sharedCeilings = snapshot.quotaPolicies
    .filter((policy) => policy.projectId === null && tribeIds.has(policy.ownerTribeId) && policy.status === "active")
    .flatMap((policy) =>
      KINDS.map((environmentKind) => ({
        legacyPolicyId: policy.id,
        tribeId: policy.ownerTribeId,
        environmentKind,
        legacyProjectIds: plannedProjects
          .filter((project) => project.tribeId === policy.ownerTribeId && project.environments.some((environment) => environment.kind === environmentKind))
          .map((project) => project.legacyProjectId),
        windowSeconds: policy.windowSeconds,
        maxRequests: policy.burstRequests ?? policy.maxRequests,
        mode: policy.mode === "enforce" ? ("enforce" as const) : ("observe" as const),
      })),
    )
    .filter((ceiling) => ceiling.legacyProjectIds.length > 0);

  return {
    organizationId: snapshot.organizationId,
    catalogRevision: catalogRevision(),
    teams: tribes.map((tribe) => ({ tribeId: tribe.tribeId, slug: slugify(tribe.tribeId), name: tribe.name })),
    projects: plannedProjects,
    sharedCeilings,
    blockers,
    approximations,
  };
}

function digest(value: unknown): string {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
