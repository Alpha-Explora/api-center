import type { DetailedOperation } from "./contracts";
import type { SdkOperation } from "./sdk-operations";

/** HTTP snippets: `fetch` from a server (TypeScript) and `cURL`. The SDK snippet is buildSdkSnippet. */
export type SnippetTab = "fetch" | "cURL";

export function buildSnippet(op: DetailedOperation, tab: SnippetTab): string {
  const url = `${op.serverUrl}${op.path}`;
  const requiresBody = op.requestProperties.length > 0;
  const body = op.sampleRequest ? JSON.stringify(op.sampleRequest, null, 2) : requiresBody ? "{} /* Fill the documented request fields. */" : null;
  const pathNote = op.pathParameters.length ? "// Replace the path placeholders with your resource identifiers.\n" : "";
  const variable = op.credentialKind === "application" ? "APICENTER_API_KEY" : null;
  if (tab === "cURL") {
    const lines = [`curl -X ${op.method} "${url}"`];
    if (variable) lines.push(`  -H "Authorization: Bearer $${variable}"`);
    if (op.requiresIdempotency) lines.push(`  -H "Idempotency-Key: $(uuidgen)"`);
    if (requiresBody) {
      lines.push('  -H "Content-Type: application/json"');
      const json = op.sampleRequest ? JSON.stringify(op.sampleRequest).replace(/'/g, "'\\''") : "<REQUEST_BODY_JSON>";
      lines.push(`  --data '${json}'`);
    }
    return (op.pathParameters.length ? "# Replace the path placeholders with your resource identifiers.\n" : "") + lines.join(" \\\n");
  }
  const headers: string[] = [];
  if (variable) headers.push('    Authorization: "Bearer " + credential');
  if (op.requiresIdempotency) headers.push('    "Idempotency-Key": crypto.randomUUID()');
  if (body) headers.push('    "Content-Type": "application/json"');
  return `${pathNote}${variable ? `const credential = process.env.${variable};\nif (!credential) throw new Error("${variable} is required");\n` : ""}${body ? `const requestBody = ${body};\n` : ""}
const response = await fetch("${url}", {
  method: "${op.method}"${headers.length ? `,\n  headers: {\n${headers.join(",\n")}\n  }` : ""}${body ? ",\n  body: JSON.stringify(requestBody)" : ""}
});
if (!response.ok) throw new Error("APICenter request failed: " + response.status);
${op.successResponses.every((response) => response.code === 204) ? "// Success has no response body." : "const data = await response.json();"}`;
}

/**
 * The same call through the server-side SDK, from the method the SDK tags for this operation. Path
 * parameters take values from the response example where it has them; the body is the request example.
 */
export function buildSdkSnippet(op: DetailedOperation, sdk: SdkOperation): string {
  const args: string[] = [];
  for (const parameter of sdk.parameters) {
    if (parameter.name === "options") continue;
    if (parameter.type === "string") {
      args.push(JSON.stringify(exampleValue(op.sampleResponse, parameter.name) ?? `your-${kebab(parameter.name)}`));
      continue;
    }
    if (op.sampleRequest) args.push(objectLiteral(op.sampleRequest));
    else if (!parameter.optional) args.push("{ /* the documented request fields */ }");
  }
  const result = resultName(sdk.call);
  const call = `await api.${sdk.call}(${args.join(", ")})`;
  const returnsNothing = op.successResponses.every((response) => response.code === 204);
  return `import { ApiCenter } from "@alpha-explora/apicenter-sdk";

const api = new ApiCenter(); // reads APICENTER_API_KEY

${op.requiresIdempotency ? "// The SDK sends an Idempotency-Key and retries safely with it.\n" : ""}${returnsNothing ? `${call};` : `const ${result} = ${call};`}`;
}

/** A readable name for what the call returns: `checkout`, `intent`, `message`, `me`. */
function resultName(call: string): string {
  const parts = call.split(".");
  const area = parts.length > 1 ? parts[parts.length - 2] : "";
  if (parts.length === 1) return call === "whoami" ? "me" : "result";
  if (area === "email" || area === "sms") return "message";
  if (area === "google" || area === "geo") return "result";
  if (area === "otp") return "challenge";
  if (area === "paymentLinks") return "paymentLink";
  return area.endsWith("s") ? area.slice(0, -1) : area || "result";
}

/** A value for `name` found anywhere in the example (checkoutId in data.checkoutId), if it is a string. */
function exampleValue(example: unknown, name: string): string | undefined {
  if (!example || typeof example !== "object") return undefined;
  for (const [key, value] of Object.entries(example as Record<string, unknown>)) {
    if (key === name && typeof value === "string") return value;
    const nested = exampleValue(value, name);
    if (nested) return nested;
  }
  return undefined;
}

/** JSON as a TypeScript object literal: identifier keys unquoted. */
function objectLiteral(value: unknown): string {
  return JSON.stringify(value, null, 2).replace(/^(\s*)"([A-Za-z_$][\w$]*)":/gm, "$1$2:");
}

function kebab(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
}
