import { z } from "zod";
import { authorizeService } from "@/lib/server/organization-access";
import { apiCenterAdminJson } from "@/lib/server/api-center-admin";
import { managementRouteErrorResponse } from "@/lib/server/management-route-error";
import {
  goLiveSchema,
  credentialSchema,
} from "@/features/services/go-live/model/go-live";

const registry = z.object({
  data: z.object({
    serviceId: z.string(),
    consumes: z.array(z.string()),
    environments: z.array(
      z.object({ environment: z.string(), baseUrl: z.string() }),
    ),
  }),
});
const consumers = z.object({
  data: z.array(
    z.object({
      consumerServiceId: z.string(),
      environment: z.string(),
      keys: z.array(credentialSchema),
    }),
  ),
});
const secretMetadata = z.object({
  versionName: z.string(),
  createdAt: z.string().nullable(),
  rotationState: z.string(),
  lastUsedAt: z.string().nullable(),
  replacementVerifiedAt: z.string().nullable(),
  cacheTtlSeconds: z.number(),
});
const evidence = z.object({
  data: z.object({
    sections: z.array(
      z.object({
        key: z.string(),
        status: z.enum(["pass", "fail", "not_applicable"]),
      }),
    ),
  }),
  meta: z.object({
    verification: z
      .object({
        checks: z.array(
          z.object({
            checkId: z.string(),
            status: z.enum([
              "passed",
              "failed",
              "missing",
              "stale",
              "not_applicable",
            ]),
          }),
        ),
        secret: secretMetadata.nullable(),
        run: z.object({ runId: z.string(), status: z.string() }).nullable(),
      })
      .nullable(),
  }),
});

export async function GET(
  request: Request,
  context: { params: Promise<{ serviceId: string }> },
) {
  try {
    const { serviceId } = await context.params;
    await authorizeService(request, serviceId, "observer");
    const environment = new URL(request.url).searchParams.get("environment");
    if (environment !== "test" && environment !== "live")
      return Response.json(
        { error: "Environment must be test or live" },
        { status: 400 },
      );
    const [serviceResponse, consumerResponse, evidenceResponse] =
      await Promise.all([
        apiCenterAdminJson<unknown>(
          `/api/v1/registry/services/${encodeURIComponent(serviceId)}`,
        ),
        apiCenterAdminJson<unknown>("/api/v1/admin/payments/consumers"),
        apiCenterAdminJson<unknown>(
          `/api/v1/admin/operations/evidence/${encodeURIComponent(serviceId)}?environment=${environment}`,
        ),
      ]);
    const service = registry.parse(serviceResponse).data;
    const keys =
      consumers
        .parse(consumerResponse)
        .data.find(
          (item) =>
            item.consumerServiceId === serviceId &&
            item.environment === environment,
        )?.keys ?? [];
    const promotion = evidence.parse(evidenceResponse);
    const checks = promotion.data.sections.map((section) => ({
      key: section.key,
      label:
        section.key === "smoke"
          ? "Authenticated verification"
          : section.key === "manifest"
            ? "Environment registration"
            : section.key,
      status:
        section.status === "pass"
          ? ("passed" as const)
          : section.status === "not_applicable"
            ? ("not_applicable" as const)
            : ("missing" as const),
      action:
        section.status === "pass"
          ? "Current evidence available"
          : section.key === "approval"
            ? "Request approval for this service and environment"
            : "Review the service configuration and run protected verification",
    }));
    if (environment === "test")
      for (const check of checks)
        if (check.key === "approval") check.status = "passed";
    const observedSecret = promotion.meta.verification?.secret;
    const secret: z.infer<typeof goLiveSchema>["secret"] = observedSecret
      ? { status: "present", ...observedSecret }
      : {
          status: "unknown",
          versionName: null,
          createdAt: null,
          rotationState: null,
          lastUsedAt: null,
          replacementVerifiedAt: null,
          cacheTtlSeconds: null,
        };
    const fullChecks: z.infer<typeof goLiveSchema>["checks"] = [
      ...checks,
      {
        key: "service-secret",
        label: "Service secret",
        status: secret.status === "present" ? "passed" : "missing",
        action: "Open Actions → Service secret to provision or rotate",
      },
    ];
    for (const check of promotion.meta.verification?.checks ?? [])
      fullChecks.push({
        key: `verification-${check.checkId}`,
        label: check.checkId.replaceAll(".", " "),
        status: check.status,
        action:
          check.status === "passed"
            ? "Observed by the protected verification runner"
            : "Request current verification with the protected CI runner",
      });
    if (service.consumes.some((id) => id === "payments" || id === "payment"))
      fullChecks.push({
        key: "payment-key",
        label: "Payment API key",
        status: keys.some(
          (key) =>
            !key.revokedAt &&
            (!key.expiresAt || Date.parse(key.expiresAt) > Date.now()),
        )
          ? "passed"
          : "missing",
        action: "Open Shared services setup → Payment consumers",
      });
    return Response.json({
      success: true,
      data: goLiveSchema.parse({
        serviceId,
        environment,
        ready: fullChecks.every(
          (check) =>
            check.status === "passed" || check.status === "not_applicable",
        ),
        checks: fullChecks,
        keys,
        secret,
        verificationRun: promotion.meta.verification?.run ?? null,
        configurationTemplate: `APICENTER_URL=${process.env.NEXT_PUBLIC_API_CENTER_BASE_URL || "https://api.apicenter.itsandbox.site"}\nAPICENTER_SERVICE_ID=${serviceId}\nAPICENTER_ENVIRONMENT=${environment}\nAPICENTER_SERVICE_SECRET=<matching-service-secret>`,
      }),
    });
  } catch (error) {
    return managementRouteErrorResponse(error, "Go-live status unavailable");
  }
}
