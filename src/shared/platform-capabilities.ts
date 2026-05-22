export const PLATFORM_CAPABILITY_SCOPES = {
  kafka: ["external:kafka:read", "external:kafka:write"],
} as const;

export type PlatformCapabilityId = keyof typeof PLATFORM_CAPABILITY_SCOPES;

export function isPlatformCapability(
  capabilityId: string,
): capabilityId is PlatformCapabilityId {
  return capabilityId in PLATFORM_CAPABILITY_SCOPES;
}

export function getPlatformCapabilityScopes(capabilityId: string): string[] {
  if (!isPlatformCapability(capabilityId)) {
    return [];
  }

  return [...PLATFORM_CAPABILITY_SCOPES[capabilityId]];
}
