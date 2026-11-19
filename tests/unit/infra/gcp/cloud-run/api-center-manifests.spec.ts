import { readFileSync } from "fs";
import { resolve } from "path";

function readManifest(name: string): string {
  return readFileSync(
    resolve(process.cwd(), "infra", "gcp", "cloud-run", name),
    "utf8",
  );
}

function expectEnvValue(manifest: string, name: string, value: string): void {
  const pattern = new RegExp(
    `- name: ${name}\\s+value: ${value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
    "m",
  );

  expect(manifest).toMatch(pattern);
}

describe("api-center Cloud Run manifests", () => {
  it.each(["api-center.staging.yaml", "api-center.prod.yaml"])(
    "%s carries production-safe non-secret runtime config",
    (manifestName) => {
      const manifest = readManifest(manifestName);

      expectEnvValue(manifest, "ALLOWED_ORIGINS", "https://api-center-management-test.itsandbox.site");
      expect(manifest).not.toMatch(/REDIS/);
      expect(manifest).toMatch(/startupProbe:\s+httpGet:\s+path: \/api\/v1\/health\/live/s);
      expect(manifest).toMatch(/timeoutSeconds: 5/);
      expect(manifest).not.toMatch(/name: PORT/);
    },
  );

  it("keeps production ingress restricted to the Cloud Run load balancer", () => {
    const manifest = readManifest("api-center.prod.yaml");

    expect(manifest).toMatch(
      /run.googleapis.com\/ingress: internal-and-cloud-load-balancing/,
    );
    expect(manifest).toMatch(/run.googleapis.com\/invoker-iam-disabled: "true"/);
  });
});
