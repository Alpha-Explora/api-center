const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { runBoundaryChecks } = require("../../../scripts/check-boundaries.js");

function run(name, fn) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

function withTempRepo(files, fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "apic-boundary-"));
  try {
    for (const [relPath, content] of Object.entries(files)) {
      const target = path.join(root, relPath);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content, "utf8");
    }
    return fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

run("fails direct cross-context imports of internal services", () => {
  withTempRepo(
    {
      "apps/gateway/src/analytics/bad.ts":
        'import { RegistryInternalService } from "../registry/registry-internal.service";\nexport const x = RegistryInternalService;\n',
      "apps/gateway/src/registry/registry-internal.service.ts": "export class RegistryInternalService {}\n",
    },
    (repoRoot) => {
      const violations = runBoundaryChecks({ repoRoot });
      assert.match(
        violations.map((violation) => violation.reason).join("\n"),
        /Cross-context import.*registry-internal\.service\.ts/,
      );
    },
  );
});

run("allows public module and dto imports across contexts", () => {
  withTempRepo(
    {
      "apps/gateway/src/analytics/good.ts":
        'import { RegistryModule } from "../registry/registry.module";\nimport { RegistryDto } from "../registry/registry.dto";\nexport const x = [RegistryModule, RegistryDto];\n',
      "apps/gateway/src/registry/registry.module.ts": "export class RegistryModule {}\n",
      "apps/gateway/src/registry/registry.dto.ts": "export class RegistryDto {}\n",
    },
    (repoRoot) => {
      const violations = runBoundaryChecks({ repoRoot });
      assert.equal(violations.length, 0);
    },
  );
});

run("fails raw SQL against another bounded context schema", () => {
  withTempRepo(
    {
      "apps/gateway/src/analytics/bad-sql.ts":
        "export const sql = \"select * from apic_governance.approval_requests\";\n",
    },
    (repoRoot) => {
      const violations = runBoundaryChecks({ repoRoot });
      assert.match(
        violations.map((violation) => violation.reason).join("\n"),
        /Schema-qualified access to apic_governance/,
      );
    },
  );
});

run("fails Prisma schemas without a bounded-context owner", () => {
  withTempRepo(
    {
      "prisma/schema.prisma":
        'model Mystery {\n  id String @id\n  @@schema("apic_unknown")\n}\n',
    },
    (repoRoot) => {
      const violations = runBoundaryChecks({ repoRoot });
      assert.match(
        violations.map((violation) => violation.reason).join("\n"),
        /No bounded-context owner is defined for schema apic_unknown/,
      );
    },
  );
});
