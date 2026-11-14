// Matches requests on a published API to the publisher-declared operation and its action.
// Patterns use literal segments and {name} placeholders that match exactly one segment.

export interface ApiOperation {
  method: string;
  pathPattern: string;
  action: string;
}

const SEGMENT = /^([A-Za-z0-9._~-]+|\{[A-Za-z][A-Za-z0-9_]*\})$/;

export function isValidPathPattern(pattern: string): boolean {
  if (pattern === "/") return true;
  if (!pattern.startsWith("/")) return false;
  const segments = pattern.replace(/\/$/, "").split("/").slice(1);
  return segments.length > 0 && segments.every((segment) => SEGMENT.test(segment) && !/^\.+$/.test(segment));
}

function compile(pattern: string): RegExp {
  if (pattern === "/") return /^\/?$/;
  const body = pattern
    .replace(/\/$/, "")
    .split("/")
    .slice(1)
    .map((segment) => (segment.startsWith("{") ? "[^/]+" : segment.replace(/[.~-]/g, (char) => `\\${char}`)))
    .join("/");
  return new RegExp(`^/${body}/?$`);
}

/** The action of the first operation matching the request; literal segments win over placeholders. */
export function matchApiOperation(operations: ApiOperation[], method: string, relativePath: string): string | undefined {
  const upper = method.toUpperCase();
  const candidates = operations
    .filter((operation) => operation.method === upper && compile(operation.pathPattern).test(relativePath))
    .sort((left, right) => placeholders(left.pathPattern) - placeholders(right.pathPattern));
  return candidates[0]?.action;
}

function placeholders(pattern: string): number {
  return (pattern.match(/\{/g) ?? []).length;
}
