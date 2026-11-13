// Public types of the control plane (rebuild slice 1). Other gateway contexts may import this file.

export type EnvironmentKind = "test" | "live";

export type ResourceStatus = "active" | "suspended" | "archived";

/** The ownership tuple every application request resolves to. Derived from the credential alone. */
export interface ApplicationIdentity {
  organizationId: string;
  projectId: string;
  environmentId: string;
  environmentKind: EnvironmentKind;
  applicationId: string;
  credentialId: string;
}

/** A capability call the control plane authenticated and authorized. */
export interface AuthorizedCapabilityCall {
  identity: ApplicationIdentity;
  capability: string;
  action: string;
  /** Short-lived signed context for the runtime. Forward it as `X-APICenter-Context`. */
  signedContext: string;
  /** The usage record key this request was counted under. */
  requestKey: string;
  /** The owner runtimes scope this request's records to. */
  resourceOwner: ResourceOwner;
}

/** Runtimes scope records by owner group and project. Usually (organization, project). */
export interface ResourceOwner {
  groupId: string;
  projectId: string;
}

export const RUNTIME_CONTEXT_HEADER = "X-APICenter-Context";

/** Bearer prefix that marks an application credential rather than a legacy service JWT. */
export const APPLICATION_CREDENTIAL_PREFIX = "ak_";

export function isApplicationCredential(bearer: string | undefined): boolean {
  return typeof bearer === "string" && bearer.startsWith(APPLICATION_CREDENTIAL_PREFIX);
}
