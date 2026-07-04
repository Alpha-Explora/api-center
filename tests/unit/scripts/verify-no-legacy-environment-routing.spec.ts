import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const { scanForLegacyRouting } = require("../../../scripts/verify-no-legacy-environment-routing");

function createTrackedRepo(files: Record<string, string>): string {
  const repoRoot = mkdtempSync(join(tmpdir(), "legacy-routing-"));
  execFileSync("git", ["init"], { cwd: repoRoot, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "test@example.com"], {
    cwd: repoRoot,
  });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: repoRoot });

  for (const [relativePath, text] of Object.entries(files)) {
    const absolutePath = join(repoRoot, relativePath);
    mkdirSync(dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, text);
  }

  execFileSync("git", ["add", "."], { cwd: repoRoot, stdio: "ignore" });
  execFileSync("git", ["commit", "-m", "fixtures"], {
    cwd: repoRoot,
    stdio: "ignore",
  });

  return repoRoot;
}

describe("verify-no-legacy-environment-routing", () => {
  it("treats decommission docs as historical evidence", () => {
    const repoRoot = createTrackedRepo({
      "docs/operations/api-center-test-decommission-2026-06-30.md":
        "Retired https://api-center-test.itsandbox.site after one-URL cutover.",
    });

    const result = scanForLegacyRouting(repoRoot);

    expect(result.violations).toEqual([]);
    expect(result.historicalMatches).toEqual([
      expect.objectContaining({
        file: "docs/operations/api-center-test-decommission-2026-06-30.md",
        rule: "legacy_test_url",
      }),
    ]);
  });
});
