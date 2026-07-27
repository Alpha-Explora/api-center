import type { SmokeTestRequest } from "@/lib/schemas";

export type SmokeTargets = {
  email: string;
  phone: string;
};

export type SmokeTestPreset = Omit<SmokeTestRequest, "bearerToken" | "body"> & {
  id: string;
  label: string;
  description: string;
  group?: string;
  safe: boolean;
  body?: unknown | ((targets: SmokeTargets) => unknown);
};

export const smokeTests: SmokeTestPreset[] = [
  {
    id: "gauth-health",
    serviceId: "gauth",
    label: "Google auth health",
    description: "Checks the Google auth wrapper without starting OAuth.",
    method: "GET",
    path: "/health",
    safe: true,
  },
  {
    id: "gauth-authorize",
    serviceId: "gauth",
    label: "Google auth URL",
    description: "Creates a Google authorization URL; no provider token is exchanged.",
    method: "POST",
    path: "/oauth/authorize",
    body: {
      redirectUri: "https://api-center.itsandbox.site/api/v1/shared/gauth/oauth/callback",
      scopes: ["openid", "email", "profile"],
      state: "smoke-test",
    },
    safe: true,
  },
  {
    id: "geo-health",
    serviceId: "geo",
    label: "Geo health",
    description: "Checks the geo wrapper configuration.",
    method: "GET",
    path: "/health",
    safe: true,
  },
  {
    id: "geo-geofence",
    serviceId: "geo",
    label: "Geo fence check",
    description: "Uses local geofence math and does not spend Google Maps quota.",
    method: "POST",
    path: "/geofence/check",
    body: {
      latitude: 14.5995,
      longitude: 120.9842,
      fences: [
        {
          fenceId: "manila-test",
          name: "Manila test fence",
          latitude: 14.5995,
          longitude: 120.9842,
          radiusMeters: 500,
        },
      ],
    },
    safe: true,
  },
  {
    id: "payment-health",
    serviceId: "payment",
    label: "Payment health",
    description: "Checks the PayMongo-backed payment wrapper.",
    group: "Payment health",
    method: "GET",
    path: "/health",
    safe: true,
  },
  {
    id: "payment-subscription-missing",
    serviceId: "payment",
    label: "Subscription route check",
    description: "Checks that subscription reads return a controlled response for an unknown ID.",
    group: "Subscription setup",
    method: "GET",
    path: "/subscriptions/sub_smoke_missing",
    safe: true,
  },
  {
    id: "payment-checkout",
    serviceId: "payment",
    label: "Payment checkout",
    description: "Creates provider-side checkout test data when PayMongo is configured.",
    group: "Checkout session",
    method: "POST",
    path: "/checkout/sessions",
    body: () => {
      const id = `smoke-order-${Date.now()}`;
      return {
        referenceId: id,
        idempotencyKey: id,
        successUrl: "https://api-center.itsandbox.site/smoke/success",
        cancelUrl: "https://api-center.itsandbox.site/smoke/cancel",
        lineItems: [
          {
            name: "Smoke Test Item",
            quantity: 1,
            amount: { value: 10000, currency: "PHP" },
          },
        ],
      };
    },
    safe: false,
  },
  {
    id: "payment-customer",
    serviceId: "payment",
    label: "Create smoke customer",
    description: "Creates or updates a deterministic smoke customer record.",
    group: "Subscription setup",
    method: "POST",
    path: "/customers",
    body: {
      customerId: "cus_smoke_management",
      email: "smoke@example.com",
      name: "Smoke Test Customer",
      metadata: { source: "apicenter-management" },
    },
    safe: false,
  },
  {
    id: "payment-product",
    serviceId: "payment",
    label: "Create smoke product",
    description: "Creates or updates a deterministic subscription product.",
    group: "Subscription setup",
    method: "POST",
    path: "/products",
    body: {
      productId: "prod_smoke_management",
      name: "Smoke Subscription",
      metadata: { source: "apicenter-management" },
    },
    safe: false,
  },
  {
    id: "payment-price",
    serviceId: "payment",
    label: "Create smoke price",
    description: "Creates a recurring price used by the subscription smoke check.",
    group: "Subscription setup",
    method: "POST",
    path: "/prices",
    body: {
      priceId: "price_smoke_management_monthly",
      productId: "prod_smoke_management",
      amount: { value: 10000, currency: "PHP" },
      recurring: { interval: "month", intervalCount: 1 },
      metadata: { source: "apicenter-management" },
    },
    safe: false,
  },
  {
    id: "payment-subscription",
    serviceId: "payment",
    label: "Create smoke subscription",
    description: "Creates the guarded API Center subscription record when subscriptions are enabled.",
    group: "Subscription lifecycle",
    method: "POST",
    path: "/subscriptions",
    body: {
      subscriptionId: "sub_smoke_management",
      referenceId: "smoke-management-subscription",
      idempotencyKey: "smoke-management-subscription",
      customerId: "cus_smoke_management",
      priceId: "price_smoke_management_monthly",
      metadata: { source: "apicenter-management" },
    },
    safe: false,
  },
  {
    id: "payment-subscription-read",
    serviceId: "payment",
    label: "Read smoke subscription",
    description: "Reads the deterministic smoke subscription after creation.",
    group: "Subscription lifecycle",
    method: "GET",
    path: "/subscriptions/sub_smoke_management",
    safe: false,
  },
  {
    id: "payment-subscription-cancel",
    serviceId: "payment",
    label: "Cancel smoke subscription",
    description: "Marks the deterministic smoke subscription cancelled in the wrapper state.",
    group: "Subscription lifecycle",
    method: "POST",
    path: "/subscriptions/sub_smoke_management/cancel",
    body: {
      cancelAtPeriodEnd: false,
      reason: "smoke_test_cleanup",
    },
    safe: false,
  },
  {
    id: "email-health",
    serviceId: "email",
    label: "Email health",
    description: "Checks the email wrapper configuration.",
    method: "GET",
    path: "/health",
    safe: true,
  },
  {
    id: "email-send",
    serviceId: "email",
    label: "Email send",
    description: "Sends a real or provider-mock email depending on runtime configuration.",
    method: "POST",
    path: "/send",
    body: (targets: SmokeTargets) => ({
      to: targets.email,
      subject: "API Center smoke test",
      text: "This is a smoke test from API Center shared services.",
    }),
    safe: false,
  },
  {
    id: "sms-health",
    serviceId: "sms",
    label: "SMS health",
    description: "Checks the SMS wrapper configuration.",
    method: "GET",
    path: "/health",
    safe: true,
  },
  {
    id: "sms-send",
    serviceId: "sms",
    label: "SMS send",
    description: "Sends through the SMS runtime; confirm provider mode first.",
    method: "POST",
    path: "/send",
    body: (targets: SmokeTargets) => ({
      to: targets.phone,
      message: "API Center smoke test",
    }),
    safe: false,
  },
  {
    id: "otp-health",
    serviceId: "otp",
    label: "OTP health",
    description: "Checks the OTP wrapper and storage state.",
    method: "GET",
    path: "/health",
    safe: true,
  },
  {
    id: "otp-generate",
    serviceId: "otp",
    label: "OTP generate",
    description: "Creates an OTP record and may trigger email/SMS delivery.",
    method: "POST",
    path: "/generate",
    body: (targets: SmokeTargets) => ({
      target: targets.email,
      channel: "email",
      length: 6,
      expiresInSeconds: 300,
    }),
    safe: false,
  },
];
