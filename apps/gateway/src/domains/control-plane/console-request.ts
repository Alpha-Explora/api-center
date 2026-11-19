// Request parsing shared by the console controllers that live outside control-plane-admin.controller.ts.

import { z } from "zod";
import { ValidationError } from "@shared/errors";
import type { ConsoleActor } from "./console-access.policy";
import type { ConsoleRequest } from "./console-actor.guard";

export const slugSchema = z.string().regex(/^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$/, "must be lowercase letters, digits and hyphens");
export const nameSchema = z.string().trim().min(1).max(128);
export const emailSchema = z.string().trim().toLowerCase().email().max(320);
export const organizationIdSchema = z.string().uuid();

export function parse<T>(schema: z.ZodType<T>, value: unknown, label: string): T {
  const result = schema.safeParse(value ?? {});
  if (!result.success) {
    const issue = result.error.issues[0];
    const path = issue?.path.length ? `${label}.${issue.path.join(".")}` : label;
    throw new ValidationError(`${path} ${issue?.message ?? "is invalid"}`);
  }
  return result.data;
}

export function actorOf(req: ConsoleRequest): ConsoleActor {
  if (!req.consoleActor) throw new ValidationError("Console actor is missing");
  return req.consoleActor;
}
