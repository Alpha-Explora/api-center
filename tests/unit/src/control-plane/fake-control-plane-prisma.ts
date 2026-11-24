// In-memory stand-in for the Prisma delegates the control plane uses. `where` clauses are
// matched by strict field equality, so a query that omits an ownership field finds rows from
// other organizations exactly as the database would.

type Row = Record<string, unknown>;

class FakeDelegate {
  readonly rows: Row[] = [];

  constructor(
    private readonly keyOf: (row: Row) => string,
    private readonly uniques: ((row: Row) => string | undefined)[] = [],
  ) {}

  private matches(row: Row, where: Row = {}): boolean {
    return Object.entries(where).every(([field, expected]) => {
      if (field === "OR") return (expected as Row[]).some((clause) => this.matches(row, clause));
      if (field === "AND") return (expected as Row[]).every((clause) => this.matches(row, clause));
      if (expected && typeof expected === "object" && !(expected instanceof Date)) {
        const operators = expected as Row;
        if ("in" in operators) return (operators.in as unknown[]).includes(row[field]);
        if ("not" in operators) return row[field] !== operators.not;
        if ("lt" in operators || "gte" in operators || "gt" in operators || "lte" in operators) {
          const value = row[field] as number | Date | string;
          return (
            (!("lt" in operators) || value < (operators.lt as number | Date | string)) &&
            (!("gte" in operators) || value >= (operators.gte as number | Date | string)) &&
            (!("gt" in operators) || value > (operators.gt as number | Date | string)) &&
            (!("lte" in operators) || value <= (operators.lte as number | Date | string))
          );
        }
        // Compound unique selectors such as { environmentId_capability: {...} }.
        return Object.entries(operators).every(([inner, value]) => row[inner] === value);
      }
      // Dates compare by value, as in PostgreSQL.
      if (expected instanceof Date) return row[field] instanceof Date && (row[field] as Date).getTime() === expected.getTime();
      return row[field] === expected;
    });
  }

  async count({ where }: { where?: Row } = {}) {
    return this.rows.filter((row) => this.matches(row, where)).length;
  }

  async delete({ where }: { where: Row }) {
    const index = this.rows.findIndex((row) => this.matches(row, where));
    if (index < 0) throw new Error("Record to delete not found");
    return this.rows.splice(index, 1)[0];
  }

  async deleteMany({ where }: { where?: Row } = {}) {
    const before = this.rows.length;
    for (let index = this.rows.length - 1; index >= 0; index -= 1) {
      if (this.matches(this.rows[index], where)) this.rows.splice(index, 1);
    }
    return { count: before - this.rows.length };
  }

  private assertUnique(candidate: Row, ignore?: Row) {
    for (const unique of [this.keyOf, ...this.uniques]) {
      const key = unique(candidate);
      if (key === undefined) continue;
      if (this.rows.some((row) => row !== ignore && unique(row) === key)) {
        const error = Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
        Object.setPrototypeOf(error, PrismaKnownError.prototype);
        throw error;
      }
    }
  }

  async findUnique({ where, select }: { where: Row; select?: Row }) {
    return this.project(this.rows.find((row) => this.matches(row, where)) ?? null, select);
  }

  async findFirst({ where, select }: { where: Row; select?: Row }) {
    return this.project(this.rows.find((row) => this.matches(row, where)) ?? null, select);
  }

  async findMany({ where, select, orderBy, take }: { where?: Row; select?: Row; orderBy?: Row | Row[]; take?: number } = {}) {
    let rows = this.rows.filter((row) => this.matches(row, where));
    // Honours orderBy and take, as keyset pages depend on them.
    const order = (Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : []).flatMap((entry) => Object.entries(entry));
    if (order.length) {
      rows = [...rows].sort((a, b) => {
        for (const [field, direction] of order) {
          const left = a[field] as string | number | Date;
          const right = b[field] as string | number | Date;
          if (left < right) return direction === "desc" ? 1 : -1;
          if (left > right) return direction === "desc" ? -1 : 1;
        }
        return 0;
      });
    }
    if (take !== undefined) rows = rows.slice(0, take);
    return rows.map((row) => this.project(row, select));
  }

  async groupBy({ by, where }: { by: string[]; where?: Row; _count?: unknown }) {
    const groups = new Map<string, Row & { _count: { _all: number } }>();
    for (const row of this.rows.filter((candidate) => this.matches(candidate, where))) {
      const key = JSON.stringify(by.map((field) => row[field]));
      const group = groups.get(key) ?? { ...Object.fromEntries(by.map((field) => [field, row[field]])), _count: { _all: 0 } };
      group._count._all += 1;
      groups.set(key, group);
    }
    return [...groups.values()];
  }

  async create({ data }: { data: Row }) {
    const row: Row = { createdAt: new Date(), updatedAt: new Date(), ...defaults(data), ...data };
    this.assertUnique(row);
    this.rows.push(row);
    return { ...row };
  }

  async update({ where, data }: { where: Row; data: Row }) {
    const row = this.rows.find((candidate) => this.matches(candidate, where));
    if (!row) throw new Error("Record to update not found");
    for (const [field, value] of Object.entries(data)) {
      if (value && typeof value === "object" && "increment" in (value as Row)) {
        row[field] = (row[field] as number) + ((value as { increment: number }).increment);
      } else {
        row[field] = value;
      }
    }
    row.updatedAt = new Date();
    return { ...row };
  }

  async createMany({ data, skipDuplicates }: { data: Row[]; skipDuplicates?: boolean }) {
    let count = 0;
    for (const entry of data) {
      try {
        await this.create({ data: entry });
        count += 1;
      } catch (error) {
        if (!skipDuplicates) throw error;
      }
    }
    return { count };
  }

  async updateMany({ where, data }: { where?: Row; data: Row }) {
    const rows = this.rows.filter((row) => this.matches(row, where));
    for (const row of rows) Object.assign(row, data);
    return { count: rows.length };
  }

  async upsert({ where, create, update }: { where: Row; create: Row; update: Row }) {
    const existing = this.rows.find((row) => this.matches(row, where));
    return existing ? this.update({ where, data: update }) : this.create({ data: create });
  }

  private project(row: Row | null, select?: Row) {
    if (!row) return null;
    if (!select) return { ...row };
    return Object.fromEntries(Object.keys(select).map((field) => [field, row[field]]));
  }
}

function defaults(data: Row): Row {
  const base: Row = { status: "active" };
  if ("email" in data && "role" in data && !("projectId" in data)) base.subject = null;
  if ("capability" in data && !("windowSeconds" in data) && !("requestKey" in data)) base.status = "enabled";
  if ("slug" in data && "environmentId" in data) base.authorizationVersion = 1;
  if ("lookupPrefix" in data) base.lastUsedAt = null;
  if ("targetKind" in data) {
    base.provenance = "explicit";
    base.revokedAt = null;
  }
  if ("requestKey" in data) base.outcome = "admitted";
  if ("consumerApplicationId" in data) base.status = "pending";
  if ("recipientApplicationId" in data) {
    base.status = "provisioning";
    base.eventFamily = "payments";
  }
  if ("pathPattern" in data) delete base.status;
  if ("lookupPrefix" in data) {
    base.revokedAt = null;
    base.revokedReason = null;
  }
  return base;
}

/** Matches `instanceof Prisma.PrismaClientKnownRequestError` checks in the code under test. */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { Prisma } = require("@prisma/client");
const PrismaKnownError = Prisma.PrismaClientKnownRequestError as { prototype: object };

export function createFakeControlPlanePrisma() {
  const prisma = {
    organization: new FakeDelegate((row) => String(row.id)),
    auditEvent: new FakeDelegate((row) => String(row.id)),
    cpProject: new FakeDelegate((row) => String(row.id), [(row) => `${row.organizationId}/${row.slug}`]),
    cpEnvironment: new FakeDelegate((row) => String(row.id), [(row) => `${row.projectId}/${row.kind}`]),
    cpApplication: new FakeDelegate((row) => String(row.id), [(row) => `${row.environmentId}/${row.slug}`]),
    cpCapabilityInstallation: new FakeDelegate((row) => `${row.environmentId}/${row.capability}`),
    cpApplicationGrant: new FakeDelegate((row) => String(row.id)),
    cpCredential: new FakeDelegate((row) => String(row.id), [(row) => String(row.lookupPrefix)]),
    cpCredentialOperation: new FakeDelegate((row) => String(row.operationId)),
    organizationMember: new FakeDelegate((row) => `${row.organizationId}/${row.email}`),
    cpTeam: new FakeDelegate((row) => String(row.id), [(row) => `${row.organizationId}/${row.slug}`]),
    cpTeamMember: new FakeDelegate((row) => `${row.teamId}/${row.email}`),
    cpProjectRoleAssignment: new FakeDelegate((row) => String(row.id)),
    cpEntitlement: new FakeDelegate((row) => String(row.id)),
    cpQuotaPolicy: new FakeDelegate((row) => String(row.id)),
    cpQuotaPolicyProject: new FakeDelegate((row) => `${row.policyId}/${row.projectId}`),
    cpUsageRecord: new FakeDelegate((row) => `${row.organizationId}/${row.requestKey}`),
    cpResourceOwnerMapping: new FakeDelegate((row) => `${row.projectId}/${row.environmentKind}`),
    cpPublishedApi: new FakeDelegate((row) => String(row.id), [(row) => `${row.environmentId}/${row.slug}`]),
    cpPublishedApiOperation: new FakeDelegate((row) => `${row.apiId}/${row.method}/${row.pathPattern}`),
    cpApiAccessRequest: new FakeDelegate((row) => String(row.id)),
    cpFeatureRequest: new FakeDelegate((row) => String(row.id)),
    cpEventDestination: new FakeDelegate((row) => String(row.id)),
    cpControlPlaneAssignment: new FakeDelegate((row) => `${row.projectId}/${row.environmentKind}`),
    cpLegacyMapping: new FakeDelegate((row) => `${row.sourceKind}/${row.sourceId}/${row.environmentKind}`),
    cpShadowMismatch: new FakeDelegate((row) => `${row.projectId}/${row.environmentKind}/${row.sourceServiceId}/${row.target}/${row.action}/${row.legacyAllowed}`),
    cpMigrationRun: new FakeDelegate((row) => String(row.id)),
    cpWorkloadBinding: new FakeDelegate((row) => String(row.id)),
    cpTestRecipient: new FakeDelegate((row) => `${row.projectId}/${row.recipient}`),
    quotaCounters: new Map<string, number>(),
    /** Reads the counters `$queryRaw` writes for cp_quota_counters. */
    cpQuotaCounter: {
      async findMany({ where }: { where: { budgetKey: { in: string[] }; windowStart: { gte: Date } } }) {
        return [...prisma.quotaCounters]
          .map(([key, requestCount]) => {
            const at = key.lastIndexOf("@");
            return { budgetKey: key.slice(0, at), windowStart: new Date(key.slice(at + 1)), requestCount };
          })
          .filter((row) => where.budgetKey.in.includes(row.budgetKey) && row.windowStart >= where.windowStart.gte);
      },
    },
    advisoryLocks: [] as string[],
    /** Per lock key, the promise that settles when its last waiter's transaction ends. */
    heldAdvisoryLocks: new Map<string, Promise<void>>(),
    /**
     * Each transaction gets its own handle so a pg_advisory_xact_lock taken inside it is held,
     * as in PostgreSQL, until the transaction ends; another transaction asking for the same key waits.
     */
    async $transaction<T>(work: (tx: unknown) => Promise<T>): Promise<T> {
      const releases: Array<() => void> = [];
      const tx: unknown = Object.create(prisma, { transactionReleases: { value: releases } });
      try {
        return await work(tx);
      } finally {
        for (const release of releases) release();
      }
    },
    tenantSettings: [] as string[],
    async $executeRaw(this: { transactionReleases?: Array<() => void> }, strings: TemplateStringsArray, ...values: unknown[]) {
      const sql = strings.join("?");
      if (sql.includes("pg_advisory_xact_lock")) {
        const key = String(values[0]);
        prisma.advisoryLocks.push(key);
        const previous = prisma.heldAdvisoryLocks.get(key) ?? Promise.resolve();
        let release!: () => void;
        const mine = new Promise<void>((resolve) => (release = resolve));
        const held = previous.then(() => mine);
        prisma.heldAdvisoryLocks.set(key, held);
        await previous;
        const unlock = () => {
          release();
          if (prisma.heldAdvisoryLocks.get(key) === held) prisma.heldAdvisoryLocks.delete(key);
        };
        if (this?.transactionReleases) this.transactionReleases.push(unlock);
        else unlock();
      }
      if (sql.includes("apicenter.organization_id")) prisma.tenantSettings.push(String(values[0]) || String(values[1]));
      return 1;
    },
    async $queryRaw(strings: TemplateStringsArray, ...values: unknown[]) {
      const sql = strings.join("?");
      if (sql.includes("cp_credential_organization")) {
        const row = prisma.cpCredential.rows.find((candidate) => candidate.lookupPrefix === values[0]);
        return [{ organization_id: row ? row.organizationId : null }];
      }
      if (sql.includes("cp_workload_binding(")) {
        const [issuer, subject, audience] = values as string[];
        const binding = prisma.cpWorkloadBinding.rows.find(
          (row) => row.issuer === issuer && row.subject === subject && row.audience === audience && row.status === "active",
        );
        return binding ? [{ organization_id: binding.organizationId, application_id: binding.applicationId, binding_id: binding.id }] : [];
      }
      if (sql.includes("cp_quota_counters")) {
        const [, key, start, limit] = values as [string, string, Date, number];
        const counterKey = `${key}@${start.toISOString()}`;
        const current = prisma.quotaCounters.get(counterKey);
        if (current === undefined) {
          prisma.quotaCounters.set(counterKey, 1);
          return [{ request_count: 1 }];
        }
        if (current >= limit) return [];
        prisma.quotaCounters.set(counterKey, current + 1);
        return [{ request_count: current + 1 }];
      }
      if (sql.includes("FROM apic_catalog.cp_usage_records")) {
        const [bucket, organizationId, environmentId, from] = values as [string, string, string, Date];
        const size = bucket === "hour" ? 3_600_000 : 86_400_000;
        const groups = new Map<string, Record<string, unknown>>();
        for (const row of prisma.cpUsageRecord.rows) {
          if (row.organizationId !== organizationId || row.environmentId !== environmentId || (row.createdAt as Date) < from) continue;
          const bucketStart = new Date(Math.floor((row.createdAt as Date).getTime() / size) * size);
          const key = [bucketStart.toISOString(), row.applicationId, row.capability, row.action, row.outcome].join("|");
          const group = groups.get(key) ?? { bucketStart, applicationId: row.applicationId, capability: row.capability, action: row.action, outcome: row.outcome, requests: 0 };
          group.requests = (group.requests as number) + 1;
          groups.set(key, group);
        }
        return [...groups.values()];
      }
      throw new Error(`Unexpected raw query: ${sql}`);
    },
  };
  return prisma;
}

export type FakeControlPlanePrisma = ReturnType<typeof createFakeControlPlanePrisma>;
