import { HttpException, Injectable } from "@nestjs/common";
import { getCloudRunAuthorizationHeader } from "@shared/proxy/cloud-run-auth";
import { paymentRuntimeToken, paymentRuntimeUrl } from "@shared/proxy/payment-runtime";
import { BadGatewayError, ServiceUnavailableError } from "@shared/errors";
import type { EnvironmentScope } from "./control-plane-admin.service";
import { CONSOLE_APPLICATION_ID, ConsoleRuntimeContextService } from "./console-runtime-context.service";
import type { EnvironmentKind } from "./control-plane.types";

type Action = "payments:payouts:read" | "payments:payouts:write";
type Method = "GET" | "POST" | "PUT";
export type RuntimeFetch = (url: string, init: RequestInit) => Promise<globalThis.Response>;

@Injectable()
export class PaymentsRuntimeClient {
  private fetchImpl: RuntimeFetch = (url, init) => fetch(url, init);

  constructor(private readonly contexts: ConsoleRuntimeContextService) {}

  useFetch(fetchImpl: RuntimeFetch): void {
    this.fetchImpl = fetchImpl;
  }

  async call(scope: EnvironmentScope, action: Action, method: Method, path: string, body?: unknown) {
    const context = await this.contexts.sign({ ...scope, capability: "payments", action });
    return this.request(scope.environmentKind, CONSOLE_APPLICATION_ID, context, method, path, body);
  }

  async callPlatform(environment: EnvironmentKind, action: Action, method: Method, path: string, body?: unknown) {
    const context = this.contexts.signPlatform(environment, action);
    return this.request(environment, "platform-console", context, method, path, body);
  }

  private async request(environment: EnvironmentKind, applicationId: string,
    context: ReturnType<ConsoleRuntimeContextService["signPlatform"]>, method: Method, path: string, body?: unknown) {
    const token = paymentRuntimeToken(environment);
    if (!token) throw new ServiceUnavailableError("Payment runtime token is not configured");
    const base = paymentRuntimeUrl(environment);
    const headers: Record<string, string> = {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "x-apicenter-context": context.signedContext,
      "x-apicenter-environment": environment,
      "x-apicenter-owner-tribe-id": context.resourceOwner.groupId,
      "x-apicenter-project-id": context.resourceOwner.projectId,
      "x-apicenter-consumer-service-id": applicationId,
      "x-correlation-id": context.requestId,
    };
    const cloudRunAuthorization = await getCloudRunAuthorizationHeader(base);
    if (cloudRunAuthorization) headers["x-serverless-authorization"] = cloudRunAuthorization;
    let response: globalThis.Response;
    try {
      response = await this.fetchImpl(`${base}${path}`, {
        method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15_000),
      });
    } catch (error) {
      throw new BadGatewayError(`Payment runtime unavailable: ${(error as Error).message}`);
    }
    const payload: unknown = await response.json().catch(() => undefined);
    if (!response.ok) throw new HttpException(typeof payload === "object" && payload !== null ? payload
      : { success: false, error: { code: "PAYMENT_RUNTIME_ERROR", message: `HTTP ${response.status}` } }, response.status);
    if (payload === undefined) throw new BadGatewayError("The payment runtime returned an invalid response");
    return payload;
  }
}
