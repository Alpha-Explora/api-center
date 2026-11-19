import { z } from "zod";
import type { EnvironmentKind } from "../model/control-plane";
import { workloadBindingSchema, type WorkloadBindingBody } from "../model/workload-bindings";
import { app, call, send } from "./http";

export const workloadBindings = {
  list: (organizationId: string, projectId: string, kind: EnvironmentKind, applicationId: string) =>
    call(z.array(workloadBindingSchema), `${app(organizationId, projectId, kind, applicationId)}/workload-bindings`),
  /** 409 CONFLICT when the identity is already bound to an application. */
  bind: (organizationId: string, projectId: string, kind: EnvironmentKind, applicationId: string, body: WorkloadBindingBody) =>
    call(workloadBindingSchema, `${app(organizationId, projectId, kind, applicationId)}/workload-bindings`, send("POST", body)),
  revoke: (organizationId: string, projectId: string, kind: EnvironmentKind, applicationId: string, bindingId: string) =>
    call(workloadBindingSchema, `${app(organizationId, projectId, kind, applicationId)}/workload-bindings/${encodeURIComponent(bindingId)}/revoke`, send("POST", {})),
};
