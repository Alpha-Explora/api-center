export type SecretStatusInput = {
  secretName: string;
  exists: boolean;
  latestEnabledVersion?: string;
  latestVersionCreatedAt?: string;
  observedKeyNames: string[];
  requiredKeyNames: string[];
  updatedAt?: string;
};

export const sharedServiceProviderConfigSchemas = {
  payment: {
    label: "Payment",
    requiredKeyNames: [
      "paymongo_secret_key",
      "paymongo_webhook_secret",
      "paymongo_live_mode",
    ],
  },
  sms: {
    label: "SMS",
    requiredKeyNames: ["sms_provider", "sms_api_key", "sms_sender_id"],
  },
  email: {
    label: "Email",
    requiredKeyNames: ["resend_api_key", "email_from"],
  },
  otp: {
    label: "OTP",
    requiredKeyNames: ["otp_ttl_seconds", "otp_hash_secret"],
  },
  geo: {
    label: "Geo",
    requiredKeyNames: ["google_maps_api_key"],
  },
  gauth: {
    label: "Google auth",
    requiredKeyNames: ["google_client_id", "google_client_secret"],
  },
} as const;

export type SharedServiceProviderConfigId =
  keyof typeof sharedServiceProviderConfigSchemas;

export function summarizeSecretStatus(input: SecretStatusInput) {
  const observed = new Set(input.observedKeyNames);
  const missingKeyNames = input.requiredKeyNames
    .filter((key) => !observed.has(key))
    .sort();

  return {
    secretName: input.secretName,
    exists: input.exists,
    latestEnabledVersion: input.latestEnabledVersion,
    latestVersionCreatedAt: input.latestVersionCreatedAt,
    observedKeyNames: input.observedKeyNames.sort(),
    missingKeyNames,
    status: !input.exists ? "absent" : missingKeyNames.length ? "missing" : "ready",
    updatedAt: input.updatedAt,
  };
}

export function summarizeSharedServiceProviderConfigs(input: {
  secretName: string;
  exists: boolean;
  observedKeyNames: string[];
  latestEnabledVersion?: string;
  latestVersionCreatedAt?: string;
}) {
  return Object.entries(sharedServiceProviderConfigSchemas).map(
    ([serviceId, schema]) => ({
      serviceId,
      label: schema.label,
      ...summarizeSecretStatus({
        secretName: input.secretName,
        exists: input.exists,
        observedKeyNames: input.observedKeyNames,
        requiredKeyNames: [...schema.requiredKeyNames],
        latestEnabledVersion: input.latestEnabledVersion,
        latestVersionCreatedAt: input.latestVersionCreatedAt,
      }),
    }),
  );
}

export function getTribeSecretRotationWarning(input: {
  exists: boolean;
  enabled?: boolean;
  latestVersionCreatedAt?: string;
  now?: Date;
}) {
  if (!input.exists) {
    return {
      stale: false,
      severity: "error" as const,
      message: "Tribe secret is missing.",
    };
  }

  if (input.enabled === false) {
    return {
      stale: false,
      severity: "error" as const,
      message: "Tribe secret is disabled.",
    };
  }

  if (!input.latestVersionCreatedAt) {
    return {
      stale: false,
      severity: "warning" as const,
      message: "Latest enabled version timestamp is unavailable.",
    };
  }

  const now = input.now ?? new Date();
  const createdAt = new Date(input.latestVersionCreatedAt);
  const ageDays = Math.floor(
    (now.getTime() - createdAt.getTime()) / (24 * 60 * 60 * 1000),
  );

  if (Number.isNaN(ageDays)) {
    return {
      stale: false,
      severity: "warning" as const,
      message: "Latest enabled version timestamp is invalid.",
    };
  }

  if (ageDays >= 90) {
    return {
      stale: true,
      severity: "warning" as const,
      message: `Rotate this tribe secret. Latest enabled version is ${ageDays} days old.`,
    };
  }

  return {
    stale: false,
    severity: "info" as const,
    message: `Latest enabled version is ${ageDays} days old.`,
  };
}
