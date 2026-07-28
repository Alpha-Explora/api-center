import type {
  ServiceEnvironmentManifest,
  ServiceManifest,
  ServiceRegistryEntry,
} from "../types";

type EnvironmentDefaults = {
  status: ServiceRegistryEntry["status"];
};

export function normalizeServiceEnvironments(
  service: ServiceManifest,
  defaults: EnvironmentDefaults,
): ServiceEnvironmentManifest[] {
  const runtimeState = service as Partial<ServiceRegistryEntry>;

  if (service.environments?.length) {
    return service.environments.map((environment) => ({
      environment: environment.environment,
      baseUrl: environment.baseUrl,
      healthCheck: environment.healthCheck ?? service.healthCheck,
      status: environment.status ?? defaults.status,
      healthy: environment.healthy,
      lastHealthCheckAt: environment.lastHealthCheckAt,
    }));
  }

  return [
    {
      environment: "test",
      baseUrl: service.baseUrl,
      healthCheck: service.healthCheck,
      status: defaults.status,
      healthy: runtimeState.healthy,
      lastHealthCheckAt: runtimeState.lastHealthCheckAt,
    },
  ];
}
