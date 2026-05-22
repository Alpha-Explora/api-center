type ServiceManifestOwnerInput = {
  serviceId?: string;
  serviceType?: string;
  ownerTribeId?: string;
};

export function isOwnerTribeIdRequiredForManifest(
  manifest: ServiceManifestOwnerInput,
): boolean {
  if ((manifest.serviceType ?? "tribe") !== "tribe") {
    return false;
  }

  if (manifest.ownerTribeId !== undefined) {
    return false;
  }

  if (typeof manifest.serviceId !== "string") {
    return false;
  }

  return isLikelyMicroserviceServiceId(manifest.serviceId);
}

function isLikelyMicroserviceServiceId(serviceId: string): boolean {
  return serviceId.includes("-") && !serviceId.endsWith("-tribe");
}
