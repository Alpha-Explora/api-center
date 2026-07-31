import { NextResponse } from "next/server";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";

export const dynamic = "force-static";

export async function GET() {
  const candidates = [
    path.resolve(process.cwd(), "contracts/public/apicenter.openapi.yaml"),
    path.resolve(process.cwd(), "../../contracts/public/apicenter.openapi.yaml"),
  ];
  const filePath = candidates.find((p) => existsSync(p));

  if (!filePath) {
    return NextResponse.json({ error: "OpenAPI contract not found" }, { status: 444 });
  }

  const rawYaml = readFileSync(filePath, "utf8");
  const parsedJson = parse(rawYaml);
  return NextResponse.json(parsedJson);
}
