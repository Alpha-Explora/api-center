import { z } from "zod";
import type { EnvironmentKind } from "./control-plane";

/**
 * Capabilities whose runtime holds per-environment settings. The gateway passes bodies through
 * unvalidated, so the console validates them. Payments and geo have no per-project settings.
 */
export const CONFIGURABLE_CAPABILITIES = ["email", "sms", "otp", "gauth"] as const;
export type ConfigurableCapability = (typeof CONFIGURABLE_CAPABILITIES)[number];

export function isConfigurable(capability: string): capability is ConfigurableCapability {
  return (CONFIGURABLE_CAPABILITIES as readonly string[]).includes(capability);
}

/** Why a capability has nothing to configure, shown on its row instead of a Configure button. */
export const UNCONFIGURABLE_REASONS: Record<string, string> = {
  geo: "Nothing to configure: region and language are set per request, and quotas cap lookup volume.",
};

// ── Email sender (GET, PUT) ───────────────────────────────────────────────────────────────────

/** What a PUT returns. */
export const emailSenderSchema = z.object({
  fromAddress: z.string(),
  dailyLimit: z.number().nullable(),
});
export type EmailSender = z.infer<typeof emailSenderSchema>;

/** What a GET returns: the saved sender, if any, and what an unconfigured environment uses. */
export const emailSenderSettingsSchema = z.object({
  configured: z.boolean(),
  fromAddress: z.string().nullable(),
  dailyLimit: z.number().nullable(),
  defaults: z.object({ fromAddress: z.string().nullable(), dailyLimit: z.number() }).nullable(),
});
export type EmailSenderSettings = z.infer<typeof emailSenderSettingsSchema>;

/** The form's starting values from the saved sender. */
export function emailSenderFormFrom(current: EmailSenderSettings | undefined): EmailSenderForm {
  return { fromAddress: current?.fromAddress ?? "", dailyLimit: current?.dailyLimit == null ? "" : String(current.dailyLimit) };
}

export type EmailSenderForm = { fromAddress: string; dailyLimit: string };
export type EmailSenderBody = { fromAddress: string; dailyLimit: number | null };

export const emailSenderFormSchema = z.object({
  fromAddress: z
    .string()
    .trim()
    .min(1, "Enter the address mail is sent from.")
    .max(320, "Use at most 320 characters.")
    .refine((value) => !/[\r\n]/.test(value), "Line breaks are not allowed."),
  dailyLimit: z
    .string()
    .trim()
    .refine((value) => value === "" || /^\d+$/.test(value), "Enter a whole number, or leave it empty for the platform default.")
    .refine((value) => value === "" || (Number.isSafeInteger(Number(value)) && Number(value) >= 1), "The limit must be at least 1."),
});

/** The PUT body for a valid form; an empty daily limit (`null`) means the platform's default limit. */
export function emailSenderBody(form: EmailSenderForm): EmailSenderBody {
  const parsed = emailSenderFormSchema.parse(form);
  return { fromAddress: parsed.fromAddress, dailyLimit: parsed.dailyLimit === "" ? null : Number(parsed.dailyLimit) };
}

// ── Google sign-in (GET, PUT, DELETE) ──────────────────────────────────────────────────────────

export const gauthConfigurationSchema = z.object({
  registered: z.boolean().optional(),
  credentialSettingsConfigured: z.boolean().optional(),
  status: z.string().nullable().optional(),
  redirectUris: z.array(z.string()),
  displayName: z.string(),
  hasOwnClient: z.boolean(),
  clientId: z.string().nullable(),
  secretLastChangedAt: z.string().nullable(),
});
export type GauthConfiguration = z.infer<typeof gauthConfigurationSchema>;

export const MAX_REDIRECT_URIS = 10;
export const MAX_DISPLAY_NAME = 120;

export type GauthClientMode = "shared" | "own";
export type GauthForm = {
  redirectUris: string;
  displayName: string;
  clientMode: GauthClientMode;
  clientId: string;
  clientSecret: string;
};
export type GauthBody = {
  redirectUris: string[];
  displayName: string;
  clientId?: string | null;
  clientSecret?: string;
};

/** One URI per line; blank lines and repeats are dropped. */
export function parseRedirectUris(text: string): string[] {
  return [
    ...new Set(
      text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean),
    ),
  ];
}

/** Why the runtime would refuse this redirect URI, or null when it is acceptable. */
export function redirectUriProblem(value: string, kind: EnvironmentKind): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return "is not a valid URL";
  }
  if (url.username || url.password) return "must not contain a user name or password";
  if (url.hash) return "must not contain a #fragment";
  if (url.protocol === "https:") return null;
  if (url.protocol === "http:" && url.hostname === "localhost") return kind === "test" ? null : "may use http://localhost only in test";
  return kind === "test" ? "must use https, or http://localhost" : "must use https";
}

/** True when the form's client ID differs from the stored one, so the runtime needs a new secret. */
export function needsClientSecret(form: Pick<GauthForm, "clientMode" | "clientId">, current: GauthConfiguration | undefined): boolean {
  if (form.clientMode !== "own") return false;
  return !current?.hasOwnClient || current.clientId !== form.clientId.trim();
}

/** True when saving moves an environment that has its own OAuth client back to the shared one. */
export function resetsToSharedClient(form: Pick<GauthForm, "clientMode">, current: GauthConfiguration | undefined): boolean {
  return form.clientMode === "shared" && Boolean(current?.clientId);
}

export function gauthFormSchema(kind: EnvironmentKind, current: GauthConfiguration | undefined) {
  return z
    .object({
      redirectUris: z.string(),
      displayName: z.string().trim().max(MAX_DISPLAY_NAME, `Use at most ${MAX_DISPLAY_NAME} characters.`),
      clientMode: z.enum(["shared", "own"]),
      clientId: z.string().trim().max(512, "Use at most 512 characters."),
      clientSecret: z.string().max(4096, "Use at most 4096 characters."),
    })
    .superRefine((form, context) => {
      const uris = parseRedirectUris(form.redirectUris);
      if (uris.length === 0) context.addIssue({ code: "custom", path: ["redirectUris"], message: "Add at least one redirect URI." });
      if (uris.length > MAX_REDIRECT_URIS) {
        context.addIssue({ code: "custom", path: ["redirectUris"], message: `Use at most ${MAX_REDIRECT_URIS} redirect URIs.` });
      }
      const invalid = uris.map((uri) => [uri, redirectUriProblem(uri, kind)] as const).find(([, problem]) => problem);
      if (invalid) context.addIssue({ code: "custom", path: ["redirectUris"], message: `${invalid[0]} ${invalid[1]}.` });
      if (form.clientMode !== "own") return;
      if (!form.clientId) context.addIssue({ code: "custom", path: ["clientId"], message: "Enter your OAuth client ID." });
      else if (!form.clientSecret && needsClientSecret(form, current)) {
        context.addIssue({ code: "custom", path: ["clientSecret"], message: "Enter the client secret for this client ID." });
      }
    });
}

/**
 * The PUT body for a valid form. A shared-client form clears an own client (`clientId: null`) and
 * otherwise leaves `clientId` out; the secret is sent only when typed, and is never read back.
 */
export function gauthBody(form: GauthForm, current: GauthConfiguration | undefined): GauthBody {
  const body: GauthBody = { redirectUris: parseRedirectUris(form.redirectUris), displayName: form.displayName.trim() };
  if (form.clientMode === "shared") {
    if (current?.clientId) body.clientId = null;
    return body;
  }
  body.clientId = form.clientId.trim();
  if (form.clientSecret) body.clientSecret = form.clientSecret;
  return body;
}

/** The form's starting values from the stored settings. */
export function gauthFormFrom(current: GauthConfiguration | undefined): GauthForm {
  return {
    redirectUris: (current?.redirectUris ?? []).join("\n"),
    displayName: current?.displayName ?? "",
    clientMode: current?.clientId ? "own" : "shared",
    clientId: current?.clientId ?? "",
    clientSecret: "",
  };
}
