import { readFileSync } from "fs";
import { join } from "path";

const repoRoot = join(__dirname, "..", "..", "..", "..", "..");

const moduleSource = (relativePath: string) =>
  readFileSync(join(repoRoot, "apps", "gateway", "src", "domains", relativePath), "utf8");

describe("ScopedAdminGuard module wiring", () => {
  it.each([
    ["CatalogModule", "catalog-registry/catalog/catalog.module.ts"],
    ["ComplianceModule", "compliance/compliance/compliance.module.ts"],
    ["OperationsModule", "runtime-ops/operations/operations.module.ts"],
  ])("%s imports AuthModule for guard dependencies", (_name, filePath) => {
    const source = moduleSource(filePath);

    expect(source).toContain('import { AuthModule } from "@auth/auth.module"');
    expect(source).toMatch(/imports:\s*\[[\s\S]*AuthModule/);
  });
});
