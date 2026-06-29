import { readFileSync } from "fs";
import { join } from "path";

const repoRoot = join(__dirname, "..", "..", "..", "..", "..");

const moduleSource = (relativePath: string) =>
  readFileSync(join(repoRoot, "src", relativePath), "utf8");

describe("ScopedAdminGuard module wiring", () => {
  it.each([
    ["CatalogModule", "catalog/catalog.module.ts"],
    ["ComplianceModule", "compliance/compliance.module.ts"],
    ["OperationsModule", "operations/operations.module.ts"],
  ])("%s imports AuthModule for guard dependencies", (_name, filePath) => {
    const source = moduleSource(filePath);

    expect(source).toContain(
      'import { AuthModule } from "../auth/auth.module"',
    );
    expect(source).toMatch(/imports:\s*\[[\s\S]*AuthModule/);
  });
});
