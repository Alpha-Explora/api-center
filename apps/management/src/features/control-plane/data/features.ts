import { z } from "zod";
import {
  featurePauseSchema, featureRequestSchema, featureViewSchema, operatorSchema, type FeatureChange, type FeatureScope,
  type ProjectPayoutFeature,
} from "../model/features";
import type { EnvironmentKind } from "../model/control-plane";
import { call, env, send } from "./http";

const path = (scope: FeatureScope) => env(scope.organizationId, scope.projectId, scope.kind);
const operatorsPath = "platform/operators";
const enabledSchema = z.object({ enabled: z.boolean() });
export const featureAccess = {
  list: (scope: FeatureScope) => call(z.array(featureViewSchema), `${path(scope)}/features`),
  request: (scope: FeatureScope, input: FeatureChange & { reason: string }) =>
    call(featureRequestSchema, `${path(scope)}/feature-requests`, send("POST", input)),
  cancel: (scope: FeatureScope, id: string) =>
    call(featureRequestSchema, `${path(scope)}/feature-requests/${encodeURIComponent(id)}/cancel`, send("POST")),
  decide: (id: string, input: { approve: true } | { approve: false; note: string }) =>
    call(featureRequestSchema, `feature-requests/${encodeURIComponent(id)}/decision`, send("POST", input)),
  projectSwitch: (scope: FeatureScope, feature: ProjectPayoutFeature) =>
    call(enabledSchema, `${path(scope)}/payouts/project-features/${feature}`),
  setProjectSwitch: (scope: FeatureScope, feature: ProjectPayoutFeature, enabled: boolean) =>
    call(enabledSchema, `${path(scope)}/payouts/project-features/${feature}`, send("PUT", { enabled })),
  pauses: (kind: EnvironmentKind) => call(z.array(featurePauseSchema), `payouts/feature-pauses/${kind}`),
  setPause: (kind: EnvironmentKind, feature: z.infer<typeof featurePauseSchema>["feature"], paused: boolean, reason: string) =>
    call(z.unknown(), `payouts/feature-pauses/${kind}/${feature}`, send("PUT", { paused, reason })),
  operators: () => call(z.array(operatorSchema), operatorsPath),
  changeOperator: (email: string, method: "PUT" | "DELETE") =>
    call(z.unknown(), `${operatorsPath}/${encodeURIComponent(email)}`, send(method)),
};
