import { z } from "zod";
import { environmentKindSchema, type EnvironmentKind } from "./control-plane";

/**
 * A request quota. Project policies limit one project's environment; shared ceilings are one budget that
 * every covered project draws from. Edits apply in place; a deleted policy is gone from every list.
 */
export const quotaPolicySchema = z.object({
  id: z.string(),
  scope: z.enum(["project", "shared"]),
  projectId: z.string().nullable(),
  environmentKind: environmentKindSchema,
  capability: z.string().nullable(),
  windowSeconds: z.number(),
  maxRequests: z.number(),
  mode: z.enum(["observe", "enforce"]),
  status: z.string(),
  createdBy: z.string().optional(),
  createdLevel: z.enum(["organization", "project"]).optional(),
  createdAt: z.string().optional(),
  /** Only list responses include it. */
  coveredProjectIds: z.array(z.string()).optional(),
});
export type QuotaPolicy = z.infer<typeof quotaPolicySchema>;

export const MAX_WINDOW_SECONDS = 2_678_400;
export const MAX_REQUESTS = 2_000_000_000;
export const MAX_SHARED_PROJECTS = 500;

const MINUTE = 60;
const HOUR = 3_600;
const DAY = 86_400;

export const WINDOW_PRESETS: { seconds: number; label: string }[] = [
  { seconds: 1, label: "Second" },
  { seconds: MINUTE, label: "Minute" },
  { seconds: HOUR, label: "Hour" },
  { seconds: DAY, label: "Day" },
  { seconds: 7 * DAY, label: "Week" },
  { seconds: 30 * DAY, label: "30 days" },
];

const UNITS: [number, string][] = [
  [DAY, "day"],
  [HOUR, "hour"],
  [MINUTE, "minute"],
  [1, "second"],
];

/** "hour", "5 minutes", "30 days", "90 seconds": the largest unit that divides the window exactly. */
export function formatWindow(seconds: number): string {
  for (const [size, unit] of UNITS) {
    if (seconds % size === 0) {
      const count = seconds / size;
      return count === 1 ? unit : `${count.toLocaleString("en")} ${unit}s`;
    }
  }
  return `${seconds} seconds`;
}

/** "1,000 requests / hour". */
export function formatQuotaLimit(maxRequests: number, windowSeconds: number): string {
  return `${maxRequests.toLocaleString("en")} request${maxRequests === 1 ? "" : "s"} / ${formatWindow(windowSeconds)}`;
}

export type QuotaForm = {
  /** A catalogue capability ID, or "" for every request. */
  capability: string;
  /** A preset's seconds as a string, or "custom". */
  window: string;
  customSeconds: string;
  maxRequests: string;
  mode: "enforce" | "observe";
};

export const EMPTY_QUOTA_FORM: QuotaForm = { capability: "", window: String(HOUR), customSeconds: "", maxRequests: "", mode: "enforce" };

export type QuotaPolicyBody = {
  environmentKind: EnvironmentKind;
  capability?: string;
  windowSeconds: number;
  maxRequests: number;
  mode: "enforce" | "observe";
};
export type SharedQuotaPolicyBody = QuotaPolicyBody & { projectIds: string[] };

export type QuotaFormErrors = Partial<Record<"windowSeconds" | "maxRequests" | "projectIds", string>>;
type Result<T> = { ok: true; body: T } | { ok: false; errors: QuotaFormErrors };

/** A whole number from what someone typed; thousands separators are allowed. */
function parseCount(value: string): number | undefined {
  const cleaned = value.trim().replace(/[,_\s]/g, "");
  return /^\d+$/.test(cleaned) ? Number(cleaned) : undefined;
}

/** The gateway's project quota body from the form, or what is wrong with it. */
export function quotaFormToBody(form: QuotaForm, environmentKind: EnvironmentKind): Result<QuotaPolicyBody> {
  const errors: QuotaFormErrors = {};
  const windowSeconds = form.window === "custom" ? parseCount(form.customSeconds) : parseCount(form.window);
  if (windowSeconds === undefined || windowSeconds < 1 || windowSeconds > MAX_WINDOW_SECONDS) {
    errors.windowSeconds = `Enter a whole number of seconds from 1 to ${MAX_WINDOW_SECONDS.toLocaleString("en")} (31 days).`;
  }
  const maxRequests = parseCount(form.maxRequests);
  if (maxRequests === undefined || maxRequests < 1 || maxRequests > MAX_REQUESTS) {
    errors.maxRequests = `Enter a whole number from 1 to ${MAX_REQUESTS.toLocaleString("en")}.`;
  }
  if (Object.keys(errors).length > 0 || windowSeconds === undefined || maxRequests === undefined) return { ok: false, errors };
  return {
    ok: true,
    body: {
      environmentKind,
      ...(form.capability ? { capability: form.capability } : {}),
      windowSeconds,
      maxRequests,
      mode: form.mode,
    },
  };
}

/** The gateway's shared ceiling body: the project body plus the projects it covers. */
export function sharedQuotaFormToBody(form: QuotaForm & { projectIds: string[] }, environmentKind: EnvironmentKind): Result<SharedQuotaPolicyBody> {
  const projectIds = [...new Set(form.projectIds)];
  const base = quotaFormToBody(form, environmentKind);
  const projectError =
    projectIds.length === 0
      ? "Choose at least one project."
      : projectIds.length > MAX_SHARED_PROJECTS
        ? `A shared ceiling covers at most ${MAX_SHARED_PROJECTS} projects.`
        : undefined;
  if (!base.ok) return { ok: false, errors: { ...base.errors, ...(projectError ? { projectIds: projectError } : {}) } };
  if (projectError) return { ok: false, errors: { projectIds: projectError } };
  return { ok: true, body: { ...base.body, projectIds } };
}

/** Project policies for one environment, then the shared ceilings that cover the project. */
export function policiesForEnvironment(policies: QuotaPolicy[], environmentKind: EnvironmentKind) {
  const inKind = policies.filter((policy) => policy.environmentKind === environmentKind);
  return { project: inKind.filter((policy) => policy.scope === "project"), shared: inKind.filter((policy) => policy.scope === "shared") };
}
