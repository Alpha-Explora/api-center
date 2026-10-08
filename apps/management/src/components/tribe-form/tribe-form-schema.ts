import { z } from "zod";
import {
  emptyToUndefined,
  splitCsv,
  uniqueValues,
} from "@/components/tribe-form/manifest-transform";
import {
  serviceManifestSchema,
  type ServiceManifest,
} from "@/lib/schemas";

export const formSchema = z
  .object({
    serviceId: serviceManifestSchema.shape.serviceId,
    name: serviceManifestSchema.shape.name,
    baseUrl: z.string().optional().default(""),
    serviceType: z.enum(["tribe", "shared"]),
    /** Project that owns a tribe service; its tribe is derived by the gateway. */
    projectId: z.string().optional(),
    ownerTeam: z.string().optional(),
    contact: z.string().optional(),
    version: serviceManifestSchema.shape.version,
    serviceTier: z.enum(["critical", "standard", "experimental"]),
    costCenter: z.string().optional(),
    healthCheck: z.string().optional(),
    description: z.string().max(500).optional(),
    exposesText: z.string().min(1, "At least one exposed route is required"),
    requiredScopesText: z
      .string()
      .min(1, "At least one required scope is required"),
    sharedConsumes: z.array(z.string()).default([]),
    extraConsumesText: z.string().optional(),
    tagsText: z.string().optional(),
    environments: z
      .array(
        z.object({
          environment: z.enum(["test", "staging", "uat", "demo", "live"]),
          baseUrl: z.string().url("Environment URL must be valid"),
          healthCheck: z.string().optional(),
        }),
      )
      .min(1, "At least one environment is required"),
  })
  .superRefine((values, context) => {
    if (values.serviceType === "tribe" && !values.projectId?.trim()) {
      context.addIssue({
        code: "custom",
        path: ["projectId"],
        message: "Choose the project this tribe service belongs to",
      });
    }
    const seen = new Set<string>();
    values.environments.forEach((environment, index) => {
      if (seen.has(environment.environment)) {
        context.addIssue({
          code: "custom",
          path: ["environments", index, "environment"],
          message: "Environment keys must be unique",
        });
      }
      seen.add(environment.environment);
    });
  })
  .transform((values): ServiceManifest => {
    const firstEnvironment = values.environments[0];
    const manifest = serviceManifestSchema.parse({
      serviceId: values.serviceId,
      name: values.name,
      baseUrl: firstEnvironment?.baseUrl ?? values.baseUrl,
      serviceType: values.serviceType,
      projectId:
        values.serviceType === "shared" ? undefined : emptyToUndefined(values.projectId),
      ownerTeam: emptyToUndefined(values.ownerTeam),
      contact: emptyToUndefined(values.contact),
      version: values.version,
      serviceTier: values.serviceTier,
      costCenter: emptyToUndefined(values.costCenter),
      healthCheck:
        emptyToUndefined(firstEnvironment?.healthCheck) ??
        emptyToUndefined(values.healthCheck),
      description: emptyToUndefined(values.description),
      exposes: splitCsv(values.exposesText),
      requiredScopes: splitCsv(values.requiredScopesText),
      consumes: uniqueValues([
        ...values.sharedConsumes,
        ...splitCsv(values.extraConsumesText),
      ]),
      tags: splitCsv(values.tagsText),
      environments: values.environments.map((environment) => ({
        environment: environment.environment,
        baseUrl: environment.baseUrl,
        healthCheck: emptyToUndefined(environment.healthCheck),
      })),
    });

    return manifest;
  });

export type FormInput = z.input<typeof formSchema>;
export type FormOutput = z.output<typeof formSchema>;
