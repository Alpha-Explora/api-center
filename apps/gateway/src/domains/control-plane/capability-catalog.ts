// The finite set of capability actions an application can be granted, and how gateway routes map
// to them. A route that maps to no action is denied: new runtime routes are not reachable until
// they are catalogued here.

export interface CapabilityAction {
  action: string;
  description: string;
}

interface CatalogRoute {
  method: string;
  pattern: RegExp;
  action: string;
}

interface CapabilityDefinition {
  id: string;
  name: string;
  actions: CapabilityAction[];
  routes: CatalogRoute[];
}

const CAPABILITIES: readonly CapabilityDefinition[] = [
  {
    id: "email",
    name: "Email",
    actions: [
      { action: "email:send", description: "Send an email" },
      { action: "email:read", description: "Read the delivery status of an email this project sent" },
    ],
    routes: [
      { method: "POST", pattern: /^\/send\/?$/, action: "email:send" },
      { method: "GET", pattern: /^\/status\/[^/]+\/?$/, action: "email:read" },
    ],
  },
];

export function listCapabilities(): { id: string; name: string; actions: CapabilityAction[] }[] {
  return CAPABILITIES.map(({ id, name, actions }) => ({ id, name, actions: [...actions] }));
}

export function isKnownCapability(capability: string): boolean {
  return CAPABILITIES.some((definition) => definition.id === capability);
}

export function isCatalogedAction(capability: string, action: string): boolean {
  return CAPABILITIES.some(
    (definition) =>
      definition.id === capability && definition.actions.some((entry) => entry.action === action),
  );
}

/**
 * Maps a request on a capability (path relative to the capability root, e.g. `/send`) to its
 * catalogued action. Returns undefined for anything not catalogued.
 */
export function resolveCapabilityAction(
  capability: string,
  method: string,
  relativePath: string,
): string | undefined {
  const definition = CAPABILITIES.find((entry) => entry.id === capability);
  if (!definition) return undefined;
  const upperMethod = method.toUpperCase();
  return definition.routes.find(
    (route) => route.method === upperMethod && route.pattern.test(relativePath),
  )?.action;
}
