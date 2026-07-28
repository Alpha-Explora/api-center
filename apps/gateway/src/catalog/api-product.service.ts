import { Injectable } from "@nestjs/common";

export interface ApiProduct {
  productId: string;
  displayName: string;
  category: "shared-service" | "tribe-api";
  ownerTeam: string;
  contact: string;
  serviceTier: string;
  requiredScopes: string[];
  exposes: string[];
  onboardingStatus: "available" | "restricted";
}

@Injectable()
export class ApiProductService {
  fromRegistry(services: Array<Record<string, any>>): ApiProduct[] {
    return services.map((service) => ({
      productId: String(service.serviceId),
      displayName: String(
        service.marketplace?.displayName ?? service.name ?? service.serviceId,
      ),
      category:
        service.serviceType === "shared" ? "shared-service" : "tribe-api",
      ownerTeam: String(service.ownerTeam ?? "Unassigned"),
      contact: String(service.contact ?? ""),
      serviceTier: String(
        service.marketplace?.supportTier ?? service.serviceTier ?? "standard",
      ),
      requiredScopes: Array.isArray(service.requiredScopes)
        ? service.requiredScopes
        : [],
      exposes: Array.isArray(service.exposes) ? service.exposes : [],
      onboardingStatus:
        service.status === "active" ? "available" : "restricted",
    }));
  }
}
