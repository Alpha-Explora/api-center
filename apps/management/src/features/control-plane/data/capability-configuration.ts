import { z } from "zod";
import { emailSenderSchema, gauthConfigurationSchema, type EmailSenderBody, type GauthBody } from "../model/capability-configuration";
import type { EnvironmentKind } from "../model/control-plane";
import { call, env, send } from "./http";

type Scope = { organizationId: string; projectId: string; kind: EnvironmentKind };

const path = ({ organizationId, projectId, kind }: Scope, capability: "email" | "gauth") =>
  `${env(organizationId, projectId, kind)}/capabilities/${capability}/configuration`;

/** Capability settings held by the email and Google sign-in runtimes, through the gateway. */
export const capabilityConfiguration = {
  /** Replaces the environment's email sender. The runtime cannot return the current one. */
  saveEmailSender: (scope: Scope, body: EmailSenderBody) => call(emailSenderSchema, path(scope, "email"), send("PUT", body)),
  gauth: (scope: Scope) => call(gauthConfigurationSchema, path(scope, "gauth")),
  saveGauth: (scope: Scope, body: GauthBody) => call(gauthConfigurationSchema, path(scope, "gauth"), send("PUT", body)),
  deleteGauth: (scope: Scope) => call(z.unknown(), path(scope, "gauth"), send("DELETE")),
};
