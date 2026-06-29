import fs from "node:fs";
import path from "node:path";

type SharedServiceContract = {
  sharedServices: Array<{
    serviceId: string;
    manifest: string;
    endpoints?: string[];
  }>;
};

describe("shared-service contract snapshot", () => {
  const repoRoot = path.resolve(__dirname, "..", "..", "..", "..");
  const sharedServicesRoot = process.env.API_SHARED_SERVICES_ROOT
    ? path.resolve(repoRoot, process.env.API_SHARED_SERVICES_ROOT)
    : path.resolve(repoRoot, "..", "api-shared-services");
  const allowMissingExternalManifests =
    process.env.ALLOW_MISSING_EXTERNAL_MANIFESTS === "true";
  const contractPath = path.join(
    repoRoot,
    "docs",
    "contracts",
    "shared-service-contract.json",
  );

  it("lists every route exposed by each shared-service manifest", () => {
    const contract = JSON.parse(
      fs.readFileSync(contractPath, "utf8"),
    ) as SharedServiceContract;

    for (const service of contract.sharedServices) {
      const manifestPath = resolveManifestPath(service.manifest);
      if (!fs.existsSync(manifestPath)) {
        if (
          isExternalSharedManifest(service.manifest) &&
          allowMissingExternalManifests
        ) {
          console.warn(
            `Skipping unavailable external shared-service manifest: ${service.manifest}`,
          );
          continue;
        }

        throw new Error(`Missing required file: ${service.manifest}`);
      }

      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
        serviceId: string;
        exposes: string[];
      };

      expect(service.endpoints).toEqual(manifest.exposes);
    }
  });

  function resolveManifestPath(manifestPath: string) {
    const normalized = manifestPath.split(path.sep).join("/");
    const sharedPrefix = "../api-shared-services/";

    if (normalized.startsWith(sharedPrefix)) {
      return path.join(
        sharedServicesRoot,
        normalized.slice(sharedPrefix.length),
      );
    }

    return path.resolve(repoRoot, manifestPath);
  }

  function isExternalSharedManifest(manifestPath: string) {
    return manifestPath
      .split(path.sep)
      .join("/")
      .startsWith("../api-shared-services/");
  }
});
