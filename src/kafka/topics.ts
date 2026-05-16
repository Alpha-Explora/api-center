// =============================================================================
// src/kafka/topics.ts — Centralized Kafka topic definitions
// =============================================================================

export const TOPICS = {
  // ---- API Gateway lifecycle events ----
  GATEWAY_REQUEST: "api-center.gateway.request",
  GATEWAY_RESPONSE: "api-center.gateway.response",
  GATEWAY_ERROR: "api-center.gateway.error",

  // ---- Tribe-to-tribe communication ----
  TRIBE_REQUEST: "api-center.tribe.request",
  TRIBE_RESPONSE: "api-center.tribe.response",

  // ---- External API events ----
  EXTERNAL_REQUEST: "api-center.external.request",

  // ---- Audit / Observability ----
  AUDIT_LOG: "api-center.audit.log",

  // ---- Shared-service sanitized export events ----
  SHARED_SMS_EVENTS: "api-center.shared.sms.events",
  SHARED_EMAIL_EVENTS: "api-center.shared.email.events",
  SHARED_PAYMENT_EVENTS: "api-center.shared.payment.events",
  SHARED_OTP_EVENTS: "api-center.shared.otp.events",
  SHARED_GEO_EVENTS: "api-center.shared.geo.events",
  SHARED_GAUTH_EVENTS: "api-center.shared.gauth.events",

  // ---- Service Registry events ----
  SERVICE_REGISTERED: "api-center.registry.service-registered",
  SERVICE_DEREGISTERED: "api-center.registry.service-deregistered",
  SERVICE_DEPRECATED: "api-center.registry.service-deprecated",
  SERVICE_RETIRED: "api-center.registry.service-retired",
  SERVICE_VERSION_CHANGED: "api-center.registry.service-version-changed",
  SERVICE_HEALTH_CHANGED: "api-center.registry.service-health-changed",

  // ---- Auth lifecycle events ----
  /** Emitted on successful M2M token issuance (raw JWT never included) */
  TOKEN_ISSUED: "api-center.auth.token-issued",
  /** Emitted on successful token refresh */
  TOKEN_REFRESHED: "api-center.auth.token-refreshed",
  /** Emitted on token revocation (single or session-wide) */
  TOKEN_REVOKED: "api-center.auth.token-revoked",

  // ---- Reserved (defined but not yet wired) ----
  /** @reserved Cross-tribe pub/sub events (planned) */
  TRIBE_EVENT: "api-center.tribe.event",
  /** @reserved External API response logging (planned) */
  EXTERNAL_RESPONSE: "api-center.external.response",
  /** @reserved Inbound webhook forwarding (planned) */
  EXTERNAL_WEBHOOK: "api-center.external.webhook",
} as const;

export type TopicName = (typeof TOPICS)[keyof typeof TOPICS];

export function withTopicPrefix(topic: string, prefix?: string) {
  const cleanTopic = topic.trim();
  const cleanPrefix = (prefix ?? "").trim().replace(/\.+$/, "");

  if (!cleanPrefix) return cleanTopic;
  if (cleanTopic === cleanPrefix || cleanTopic.startsWith(`${cleanPrefix}.`)) {
    return cleanTopic;
  }

  return `${cleanPrefix}.${cleanTopic}`;
}

export const SHARED_SERVICE_EVENT_TOPICS = {
  sms: TOPICS.SHARED_SMS_EVENTS,
  email: TOPICS.SHARED_EMAIL_EVENTS,
  payment: TOPICS.SHARED_PAYMENT_EVENTS,
  otp: TOPICS.SHARED_OTP_EVENTS,
  geo: TOPICS.SHARED_GEO_EVENTS,
  gauth: TOPICS.SHARED_GAUTH_EVENTS,
} as const;

export type SharedServiceEventTopicId =
  keyof typeof SHARED_SERVICE_EVENT_TOPICS;
