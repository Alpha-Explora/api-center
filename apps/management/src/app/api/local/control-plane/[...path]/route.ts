import type { NextRequest } from "next/server";
import { proxyControlPlane } from "@/lib/server/control-plane-proxy";

type Context = { params: Promise<{ path: string[] }> };

async function handle(request: NextRequest, context: Context) {
  const { path } = await context.params;
  return proxyControlPlane(request, path);
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const DELETE = handle;
