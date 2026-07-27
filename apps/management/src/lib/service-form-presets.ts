import type { ServiceManifest } from "@/lib/schemas";

export const sharedServiceOptions = [
  {
    serviceId: "gauth",
    label: "Google auth",
    description: "OAuth authorize, token, refresh, logout.",
  },
  {
    serviceId: "geo",
    label: "Geolocation",
    description: "Google Maps geocoding and geofence checks.",
  },
  {
    serviceId: "payment",
    label: "Payment",
    description: "PayMongo checkout, refunds, and webhooks.",
  },
  {
    serviceId: "email",
    label: "Email",
    description: "Resend-backed transactional email.",
  },
  {
    serviceId: "sms",
    label: "SMS",
    description: "Central SMS delivery wrapper.",
  },
  {
    serviceId: "otp",
    label: "OTP",
    description: "One-time password generation and verification.",
  },
] as const;

export const knownSharedServiceIds = sharedServiceOptions.map(
  (option) => option.serviceId,
);

export const smokeTribePreset: ServiceManifest = {
  serviceId: "smoke-tribe",
  name: "Smoke Tribe API",
  baseUrl: "http://localhost:4019",
  serviceType: "tribe",
  ownerTeam: "platform",
  contact: "platform@alphaexplora.com",
  version: "1.0.0",
  serviceTier: "experimental",
  costCenter: "API-CENTER",
  healthCheck: "/health",
  description:
    "Local test tribe used by API Center Management for shared-service smoke tests.",
  exposes: ["/health"],
  requiredScopes: ["service:read", "shared:use"],
  consumes: [...knownSharedServiceIds],
  tags: ["smoke-test", "local"],
};
