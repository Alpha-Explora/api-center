import { z } from "zod";
import {
  emailSenderSchema,
  emailSenderSettingsSchema,
  gauthConfigurationSchema,
  type EmailSenderBody,
  type GauthBody,
} from "../model/capability-configuration";
import type { EnvironmentKind } from "../model/control-plane";
import { otpSettingsSchema, type OtpSettingsBody } from "../model/otp-settings";
import { smsSenderSchema, type SmsSenderBody } from "../model/sms-sender";
import { call, env, send } from "./http";

type Scope = { organizationId: string; projectId: string; kind: EnvironmentKind };

const path = ({ organizationId, projectId, kind }: Scope, capability: "email" | "sms" | "otp" | "gauth") =>
  `${env(organizationId, projectId, kind)}/capabilities/${capability}/configuration`;

/** Capability settings held by the email, SMS, OTP and Google sign-in runtimes, through the gateway. */
export const capabilityConfiguration = {
  emailSender: (scope: Scope) => call(emailSenderSettingsSchema, path(scope, "email")),
  /** Replaces the environment's email sender. There is no delete: the runtime role cannot remove rows. */
  saveEmailSender: (scope: Scope, body: EmailSenderBody) => call(emailSenderSchema, path(scope, "email"), send("PUT", body)),
  smsSender: (scope: Scope) => call(smsSenderSchema, path(scope, "sms")),
  saveSmsSender: (scope: Scope, body: SmsSenderBody) => call(smsSenderSchema, path(scope, "sms"), send("PUT", body)),
  clearSmsSender: (scope: Scope) => call(smsSenderSchema, path(scope, "sms"), send("DELETE")),
  otpSettings: (scope: Scope) => call(otpSettingsSchema, path(scope, "otp")),
  saveOtpSettings: (scope: Scope, body: OtpSettingsBody) => call(otpSettingsSchema, path(scope, "otp"), send("PUT", body)),
  resetOtpSettings: (scope: Scope) => call(otpSettingsSchema, path(scope, "otp"), send("DELETE")),
  gauth: (scope: Scope) => call(gauthConfigurationSchema, path(scope, "gauth")),
  saveGauth: (scope: Scope, body: GauthBody) => call(gauthConfigurationSchema, path(scope, "gauth"), send("PUT", body)),
  deleteGauth: (scope: Scope) => call(z.unknown(), path(scope, "gauth"), send("DELETE")),
};
