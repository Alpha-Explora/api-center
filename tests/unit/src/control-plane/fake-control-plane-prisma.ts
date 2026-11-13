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
      if (expected && typeof expected === "object" && !(expected instanceof Date)) {
        // Compound unique selectors such as { environmentId_capability: {...} }.
        return Object.entries(expected as Row).every(([inner, value]) => row[inner] === value);
      }
      return row[field] === expected;
    });
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

  async findMany({ where, select }: { where?: Row; select?: Row } = {}) {
    return this.rows.filter((row) => this.matches(row, where)).map((row) => this.project(row, select));
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
  if ("capability" in data) base.status = "enabled";
  if ("slug" in data && "environmentId" in data) base.authorizationVersion = 1;
  if ("lookupPrefix" in data) base.lastUsedAt = null;
  if ("targetKind" in data) {
    base.provenance = "explicit";
    base.revokedAt = null;
  }
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
    cpProject: new FakeDelegate((row) => String(row.id), [(row) => `${row.organizationId}/${row.slug}`]),
    cpEnvironment: new FakeDelegate((row) => String(row.id), [(row) => `${row.projectId}/${row.kind}`]),
    cpApplication: new FakeDelegate((row) => String(row.id), [(row) => `${row.environmentId}/${row.slug}`]),
    cpCapabilityInstallation: new FakeDelegate((row) => `${row.environmentId}/${row.capability}`),
    cpApplicationGrant: new FakeDelegate((row) => String(row.id)),
    cpCredential: new FakeDelegate((row) => String(row.id), [(row) => String(row.lookupPrefix)]),
    cpCredentialOperation: new FakeDelegate((row) => String(row.operationId)),
    advisoryLocks: [] as string[],
    async $transaction<T>(work: (tx: unknown) => Promise<T>): Promise<T> {
      return work(prisma);
    },
    async $executeRaw(_strings: TemplateStringsArray, ...values: unknown[]) {
      prisma.advisoryLocks.push(String(values[0]));
      return 1;
    },
  };
  return prisma;
}

export type FakeControlPlanePrisma = ReturnType<typeof createFakeControlPlanePrisma>;
