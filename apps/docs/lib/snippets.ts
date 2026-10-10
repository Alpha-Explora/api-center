import type { DetailedOperation } from "./contracts";

export type SnippetTab = "TypeScript" | "Next.js" | "cURL";

export function buildSnippet(op: DetailedOperation, tab: SnippetTab): string {
  const url = `${op.serverUrl}${op.path}`;
  const requiresBody = op.requestProperties.length > 0;
  const body = op.sampleRequest ? JSON.stringify(op.sampleRequest, null, 2) : requiresBody ? "{} /* Fill the documented request fields. */" : null;
  const pathNote = op.pathParameters.length ? "// Replace the path placeholders with your resource identifiers.\n" : "";
  if (tab === "cURL") {
    const lines = [`curl -X ${op.method} "${url}"`, '  -H "Authorization: Bearer $PAYMENT_API_KEY"'];
    if (op.requiresIdempotency) lines.push(`  -H "Idempotency-Key: unique-key-${op.operationId}"`);
    if (requiresBody) {
      lines.push('  -H "Content-Type: application/json"');
      const json = op.sampleRequest ? JSON.stringify(op.sampleRequest).replace(/'/g, "'\\''") : "<REQUEST_BODY_JSON>";
      lines.push(`  --data '${json}'`);
    }
    return (op.pathParameters.length ? "# Replace the path placeholders with your resource identifiers.\n" : "") + lines.join(" \\\n");
  }
  return `${tab === "Next.js" ? "// Run this in a server route. Keep the payment API key on the server.\n" : ""}${pathNote}const paymentApiKey = process.env.APICENTER_PAYMENT_API_KEY;
if (!paymentApiKey) throw new Error("APICENTER_PAYMENT_API_KEY is required");
${body ? `const requestBody = ${body};\n` : ""}
const response = await fetch("${url}", {
  method: "${op.method}",
  headers: {
    Authorization: "Bearer " + paymentApiKey${op.requiresIdempotency ? `,\n    "Idempotency-Key": "unique-key-${op.operationId}"` : ""}${body ? ',\n    "Content-Type": "application/json"' : ""}
  }${body ? ",\n  body: JSON.stringify(requestBody)" : ""}
});
if (!response.ok) throw new Error("APICenter request failed: " + response.status);
const data = await response.json();
console.log(data);`;
}
