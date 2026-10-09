import { z } from "zod";

/** Mirrors the gateway tenancy model: Tribe -> Project -> Service -> Environment. */
export const tenancyStatusSchema = z.enum(["active", "suspended", "archived"]);

export const tribeIdSchema = z
  .string()
  .trim()
  .regex(/^[a-z0-9][a-z0-9-]{0,63}$/, "Use a lowercase slug of up to 64 characters");

export const projectIdSchema = z
  .string()
  .trim()
  .regex(/^[a-z0-9][a-z0-9-]{0,79}$/, "Use a lowercase slug of up to 80 characters");

export const tenancyServiceSummarySchema = z.object({
  serviceId: z.string(),
  name: z.string(),
  status: z.string(),
  consumes: z.array(z.string()).default([]),
  environments: z
    .array(z.object({ environment: z.string(), status: z.string().optional() }))
    .default([]),
});

export const tenancyProjectSchema = z.object({
  projectId: z.string(),
  tribeId: z.string(),
  name: z.string(),
  description: z.string().optional(),
  costCenter: z.string().optional(),
  status: tenancyStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  serviceCount: z.number().int().nonnegative().optional(),
  services: z.array(tenancyServiceSummarySchema).optional(),
});

export const tenancyTribeSchema = z.object({
  tribeId: z.string(),
  organizationId: z.string().uuid().optional(),
  name: z.string(),
  description: z.string().optional(),
  status: tenancyStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  projects: z.array(tenancyProjectSchema).default([]),
});

const metaSchema = z
  .object({ timestamp: z.string().optional(), correlationId: z.string().optional() })
  .optional();

export const tenancyTribeListResponseSchema = z.object({
  success: z.boolean(),
  data: z.array(tenancyTribeSchema),
  meta: metaSchema,
});

export const tenancyTribeResponseSchema = z.object({
  success: z.boolean(),
  data: tenancyTribeSchema,
  meta: metaSchema,
});

export const tenancyProjectResponseSchema = z.object({
  success: z.boolean(),
  data: tenancyProjectSchema,
  meta: metaSchema,
});

export const createTribeInputSchema = z.object({
  organizationId: z.string().uuid().optional(),
  tribeId: tribeIdSchema,
  name: z.string().trim().min(1, "Name is required").max(128),
  description: z.string().trim().max(500).optional(),
});

export const createProjectInputSchema = z.object({
  projectId: projectIdSchema,
  name: z.string().trim().min(1, "Name is required").max(128),
  description: z.string().trim().max(500).optional(),
  costCenter: z.string().trim().max(64).optional(),
});

export const updateTenancyStatusInputSchema = z.object({
  status: tenancyStatusSchema,
});

export type TenancyStatus = z.infer<typeof tenancyStatusSchema>;
export type TenancyProject = z.infer<typeof tenancyProjectSchema>;
export type TenancyTribe = z.infer<typeof tenancyTribeSchema>;
export type CreateTribeInput = z.input<typeof createTribeInputSchema>;
export type CreateProjectInput = z.input<typeof createProjectInputSchema>;
