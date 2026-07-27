export const platformCapabilities = ["kafka"] as const;

export type PlatformCapability = (typeof platformCapabilities)[number];

export function isPlatformCapability(
  capabilityId: string,
): capabilityId is PlatformCapability {
  return (platformCapabilities as readonly string[]).includes(capabilityId);
}
