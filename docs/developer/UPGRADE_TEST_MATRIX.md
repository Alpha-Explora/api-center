# APICenter Upgrade Test Matrix

Date: 2026-05-12
Owner: VP Quality
Scope: Upgrade validation for shared geo, governed Kafka publishing, and SDK typed methods.

## Scope

- Tribe namespace: `/api/v1/tribes/:serviceId/*`
- Shared namespace: `/api/v1/shared/:serviceId/*`
- Geo is a shared service registered as `geo`.
- Direct external geo APIs are removed from API Center.
- Kafka REST is not exposed through `/api/v1/external/*`; tribes publish through governed Kafka routes.

## Required Tests

| Test ID | Layer | Domain | Priority | Target | Expected result |
|---|---|---|---|---|---|
| U-EXT-001 | Unit | External registry | P0 | `src/external/apis/index.ts` | `buildExternalApis()` does not register geo APIs |
| U-EXT-002 | Unit | External policy | P0 | `src/external/guards/external-policy.guard.ts` | Removed geo external API names are denied |
| U-SHR-001 | Integration | Shared geo route | P0 | `/api/v1/shared/geo/*` | API Center proxies only to registered shared `geo` runtime |
| U-SDK-001 | Unit | SDK geo wrappers | P0 | `../api-shared-services/src/TribeClient.ts` | `geoGeocodeAddress`, `geoReverseGeocode`, and `geoFenceCheck` route through `/api/v1/shared/geo/*` |
| U-KAF-001 | Unit | Kafka governance | P0 | `src/kafka/*` | Governed publish validates topic and schema policy |
| E2E-001 | E2E | Gateway health | P0 | GKE or local stack | `/health/live` and `/health/ready` are green |
| E2E-002 | E2E | Shared geo | P0 | SDK -> API Center -> geo service | A tribe can call geo through the shared-service namespace |
| E2E-003 | E2E | Kafka governance | P0 | `/api/v1/kafka/*` | Catalog and publish routes remain functional |

## Local Validation

1. `npm ci`
2. `npm run lint`
3. `npm run typecheck`
4. `npm run build`
5. `npm test`
6. Run the SDK repo checks in `../api-shared-services`.

## Release Gates

- No legacy geo external scopes remain.
- No legacy geo provider secrets are required by API Center.
- Google Maps credentials are owned by the shared-services deployment.
- API Center registry includes a shared `geo` service before tribe consumers rely on the SDK wrappers.
