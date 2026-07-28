# Human Authentication Boundary

APICenter internal JWTs are used for tribe-to-tribe machine authentication.
Descope, when enabled, is reserved for human management/admin identity and MFA.
Provider API keys remain in the owning runtime's Secret Manager binding.

Payment lifecycle events use Google Pub/Sub with Cloud Run OIDC delivery. Kafka and
Confluent are not part of the payment command or event path.

Keep `AUTH_PROVIDER=composite` when both internal JWT issuance and human-provider
validation are required. Do not distribute provider credentials to consumer services.