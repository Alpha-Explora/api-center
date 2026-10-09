create table apic_catalog.service_spec_versions (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null references apic_catalog.services(id) on delete restrict,
  version text not null check (length(version) between 1 and 128),
  format text not null check (format in ('openapi-3.0', 'openapi-3.1', 'asyncapi-2', 'asyncapi-3')),
  document jsonb not null check (jsonb_typeof(document) = 'object'),
  sha256 char(64) not null check (sha256 ~ '^[0-9a-f]{64}$'),
  published_by text not null,
  published_at timestamptz not null default now(),
  constraint service_spec_versions_service_version_key unique (service_id, version),
  constraint service_spec_versions_service_sha256_key unique (service_id, sha256)
);

create index service_spec_versions_service_published_idx
  on apic_catalog.service_spec_versions(service_id, published_at desc);

grant select, insert on apic_catalog.service_spec_versions to api_center_app;
revoke update, delete, truncate on apic_catalog.service_spec_versions from api_center_app;
