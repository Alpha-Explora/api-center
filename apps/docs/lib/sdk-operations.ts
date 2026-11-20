// Which SDK method calls each API operation, read from the SDK's own source at build time. Every public SDK
// method carries a `@sdk-operation <operationId> <METHOD> <path>` tag; its class says where it lives on the
// client (`EmailClient` is `api.email`, `CheckoutClient` is `api.payments.checkouts`). So the docs show the
// call the SDK really has, and a renamed method changes the docs with it.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

export interface SdkOperation {
  operationId: string;
  /** "payments.checkouts.create" */
  call: string;
  /** The method's parameters, in order, with their declared types. */
  parameters: { name: string; type: string; optional: boolean }[];
}

/** Clients reached directly from `new ApiCenter()`. Payments clients are found on PaymentsNamespace. */
const ROOT_CLIENTS: Record<string, string> = {
  ApiCenter: "",
  EmailClient: "email",
  SmsClient: "sms",
  OtpClient: "otp",
  GeoClient: "geo",
  GoogleAuthClient: "auth.google",
};

function sdkDirectory(): string | undefined {
  return [path.resolve(process.cwd(), "packages/sdk/src"), path.resolve(process.cwd(), "../../packages/sdk/src")].find((candidate) =>
    existsSync(path.join(candidate, "ApiCenter.ts")),
  );
}

let cache: Map<string, SdkOperation> | undefined;

export function getSdkOperations(): Map<string, SdkOperation> {
  if (cache) return cache;
  const operations = new Map<string, SdkOperation>();
  const directory = sdkDirectory();
  if (!directory) return (cache = operations);

  const services = path.join(directory, "services");
  const sources = [
    readFileSync(path.join(directory, "ApiCenter.ts"), "utf8"),
    ...readdirSync(services)
      .filter((name) => name.endsWith(".ts"))
      .map((name) => readFileSync(path.join(services, name), "utf8")),
  ];

  // Where each client class lives on the API object.
  const locations = new Map<string, string>(Object.entries(ROOT_CLIENTS));
  for (const source of sources) {
    const namespace = /class PaymentsNamespace\b[\s\S]*?\n}/.exec(source)?.[0];
    if (!namespace) continue;
    for (const [, property, client] of namespace.matchAll(/readonly (\w+): (\w+);/g)) locations.set(client, `payments.${property}`);
  }

  for (const source of sources) {
    for (const block of source.split(/\n(?=(?:export )?class \w+)/)) {
      const className = /^(?:export )?class (\w+)/.exec(block.trimStart())?.[1];
      const location = className ? locations.get(className) : undefined;
      if (location === undefined) continue;
      for (const match of block.matchAll(/@sdk-operation ([\w.]+) [A-Z]+ \S+\s*\*\/\s*(?:async\s+)?(\w+)\(([^)]*)\)/g)) {
        const [, operationId, method, parameterList] = match;
        operations.set(operationId, { operationId, call: location ? `${location}.${method}` : method, parameters: parseParameters(parameterList) });
      }
    }
  }
  return (cache = operations);
}

function parseParameters(list: string): SdkOperation["parameters"] {
  const parameters: SdkOperation["parameters"] = [];
  let depth = 0;
  let current = "";
  for (const character of list) {
    if (character === "{" || character === "<" || character === "(") depth += 1;
    if (character === "}" || character === ">" || character === ")") depth -= 1;
    if (character === "," && depth === 0) {
      if (current.trim()) parameters.push(parameter(current));
      current = "";
    } else {
      current += character;
    }
  }
  if (current.trim()) parameters.push(parameter(current));
  return parameters;
}

function parameter(text: string) {
  const [rawName, ...typeParts] = text.split(":");
  const name = rawName.trim().replace(/\?$/, "");
  return { name, type: typeParts.join(":").trim(), optional: rawName.trim().endsWith("?") };
}
