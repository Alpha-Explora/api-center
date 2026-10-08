// =============================================================================
// Tenancy model: Organization -> Tribe -> Project -> Service -> Environment.
// =============================================================================
// A tribe owns people, approvals, and an optional tribe-wide quota ceiling.
// A project is a product or application inside a tribe; it owns plans and quota budgets.
// Every tribe-type service belongs to exactly one project, and its owning tribe is derived
// from that project. A project never moves between tribes.
// =============================================================================

export type TenancyStatus = "active" | "suspended" | "archived";

export const TENANCY_STATUSES: readonly TenancyStatus[] = [
  "active",
  "suspended",
  "archived",
];

export { PROJECT_ID_PATTERN, TRIBE_ID_PATTERN } from "@shared/tenancy-identifiers";

export interface Tribe {
  tribeId: string;
  name: string;
  description?: string;
  status: TenancyStatus;
  createdAt: string;
  updatedAt: string;
}

export interface Project {
  projectId: string;
  tribeId: string;
  name: string;
  description?: string;
  costCenter?: string;
  status: TenancyStatus;
  createdAt: string;
  updatedAt: string;
}

/** Where a tribe-type service lives. Both halves are active when returned by requireActiveProject. */
export interface ProjectPlacement {
  tribe: Tribe;
  project: Project;
}

export interface CreateTribeInput {
  tribeId: string;
  name: string;
  description?: string;
}

export interface UpdateTribeInput {
  name?: string;
  description?: string;
  status?: TenancyStatus;
}

export interface CreateProjectInput {
  projectId: string;
  tribeId: string;
  name: string;
  description?: string;
  costCenter?: string;
}

export interface UpdateProjectInput {
  name?: string;
  description?: string;
  costCenter?: string;
  status?: TenancyStatus;
}

/** Shape of the bootstrap seed file (REGISTRY_BOOTSTRAP_TENANCY). */
export interface TenancySeed {
  tribes: CreateTribeInput[];
  projects: CreateProjectInput[];
}

export interface TenancySnapshot {
  tribes: Tribe[];
  projects: Project[];
}

export interface TenancyStore {
  loadAll(): Promise<TenancySnapshot>;
  upsertTribe(tribe: Tribe): Promise<void>;
  upsertProject(project: Project): Promise<void>;
}

/** Where a registered tribe service sits. Shared platform services have no placement. */
export interface ServicePlacement {
  serviceId: string;
  projectId: string;
  tribeId: string;
}

/**
 * Read port other contexts use to resolve tribes, projects, and service placement.
 * Inject with @Inject(TENANCY_DIRECTORY); the catalog-registry context owns the implementation.
 */
export interface TenancyDirectory {
  getTribe(tribeId: string): Tribe | null;
  resolveProject(projectId: string): ProjectPlacement | null;
  /** Both project and tribe active, or a ValidationError naming the problem. */
  requireActiveProject(projectId: string | undefined): ProjectPlacement;
  /** Placement of a registered tribe service; null for unknown, shared, or unplaced services. */
  resolveServicePlacement(serviceId: string): ServicePlacement | null;
}

export const TENANCY_DIRECTORY = Symbol("TENANCY_DIRECTORY");
