import type { DetailedOperation } from "./contracts";

export type SnippetTab = "TypeScript" | "Next.js" | "cURL";

export function buildSnippet(op: DetailedOperation, tab: SnippetTab): string {
  const url = `${op.serverUrl}${op.path}`;
  const requiresBody = op.requestProperties.length > 0;
  const body = op.sampleRequest ? JSON.stringify(op.sampleRequest, null, 2) : requiresBody ? "{} /* Fill the documented request fields. */" : null;
  const pathNote = op.pathParameters.length ? "// Replace the path placeholders with your resource identifiers.\n" : "";
  const variable = op.credentialKind === "payment" ? "APICENTER_PAYMENT_API_KEY" : op.credentialKind === "service" ? "APICENTER_ACCESS_TOKEN" : null;
  if (tab === "cURL") {
    const lines = [`curl -X ${op.method} "${url}"`];
    if (variable) lines.push(`  -H "Authorization: Bearer $${variable}"`);
    if (op.requiresIdempotency) lines.push(`  -H "Idempotency-Key: unique-key-${op.operationId}"`);
    if (requiresBody) {
      lines.push('  -H "Content-Type: application/json"');
      const json = op.sampleRequest ? JSON.stringify(op.sampleRequest).replace(/'/g, "'\\''") : "<REQUEST_BODY_JSON>";
      lines.push(`  --data '${json}'`);
    }
    return (op.pathParameters.length ? "# Replace the path placeholders with your resource identifiers.\n" : "") + lines.join(" \\\n");
  }
  const headers: string[] = [];
  if (variable) headers.push('    Authorization: "Bearer " + credential');
  if (op.requiresIdempotency) headers.push(`    "Idempotency-Key": "unique-key-${op.operationId}"`);
  if (body) headers.push('    "Content-Type": "application/json"');
  return `${tab === "Next.js" ? "// Run this in a server route. Keep all credentials on the server.\n" : ""}${pathNote}${variable ? `const credential = process.env.${variable};\nif (!credential) throw new Error("${variable} is required");\n` : ""}${body ? `const requestBody = ${body};\n` : ""}
const response = await fetch("${url}", {
  method: "${op.method}"${headers.length ? `,\n  headers: {\n${headers.join(",\n")}\n  }` : ""}${body ? ",\n  body: JSON.stringify(requestBody)" : ""}
});
if (!response.ok) throw new Error("APICenter request failed: " + response.status);
${op.successResponses.every((response) => response.code === 204) ? '// Success has no response body.' : 'const data = await response.json();\nconsole.log(data);'}`;
}
