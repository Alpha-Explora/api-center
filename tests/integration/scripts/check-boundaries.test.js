const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { collectStaleAllowlistViolations, runBoundaryChecks } = require("../../../scripts/check-boundaries.js");

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

run("keeps the public contract list and legacy baseline pointing at files that exist", () => {
  const repoRoot = path.resolve(__dirname, "../../..");
  assert.deepEqual(collectStaleAllowlistViolations(repoRoot), []);
});

run("reports public contract paths and baseline entries that do not exist", () => {
  withTempRepo({ "scripts/boundary-legacy-imports.json": JSON.stringify(["apps/a.ts -> apps/b.ts"]) }, (repoRoot) => {
    const reasons = collectStaleAllowlistViolations(repoRoot).map((violation) => violation.reason).join("\n");
    assert.match(reasons, /PUBLIC_SERVICE_CONTRACT_FILES lists apps\/gateway\/src\/domains\/auth-security\/auth\/auth\.service\.ts, which does not exist/);
    assert.match(reasons, /Baseline entry "apps\/a\.ts -> apps\/b\.ts" names apps\/a\.ts, which does not exist/);
  });
});

run("fails direct cross-context imports of internal services", () => {
  withTempRepo(
    {
      "apps/gateway/src/domains/runtime-ops/analytics/bad.ts":
        'import { RegistryInternalService } from "../../catalog-registry/registry/registry-internal.service";\nexport const x = RegistryInternalService;\n',
      "apps/gateway/src/domains/catalog-registry/registry/registry-internal.service.ts": "export class RegistryInternalService {}\n",
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

run("fails alias imports that reach another context's internals", () => {
  withTempRepo({
    "apps/gateway/tsconfig.json": JSON.stringify({ compilerOptions: { paths: {
      "@registry/*": ["src/domains/catalog-registry/registry/*"],
    } } }),
    "apps/gateway/src/domains/runtime-ops/analytics/bad.ts":
      'import { RegistryInternalService } from "@registry/registry-internal.service";\n',
    "apps/gateway/src/domains/catalog-registry/registry/registry-internal.service.ts":
      'export class RegistryInternalService {}\n',
  }, (repoRoot) => {
    const violations = runBoundaryChecks({ repoRoot });
    assert.match(violations.map((violation) => violation.reason).join("\n"),
      /Cross-context import.*registry-internal\.service\.ts/);
  });
});

run("allows public module and dto imports across contexts", () => {
  withTempRepo(
    {
      "apps/gateway/src/domains/runtime-ops/analytics/good.ts":
        'import { RegistryModule } from "../../catalog-registry/registry/registry.module";\nimport { RegistryDto } from "../../catalog-registry/registry/registry.dto";\nexport const x = [RegistryModule, RegistryDto];\n',
      "apps/gateway/src/domains/catalog-registry/registry/registry.module.ts": "export class RegistryModule {}\n",
      "apps/gateway/src/domains/catalog-registry/registry/registry.dto.ts": "export class RegistryDto {}\n",
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
      "apps/gateway/src/domains/runtime-ops/analytics/bad-sql.ts":
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
