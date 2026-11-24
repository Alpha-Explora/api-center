// PayMongo's transfer status callbacks for payouts. PayMongo does not sign them, so nothing in the
// request is trusted: the path token only names the payout, and the payments runtime confirms the
// transfer's status by reading it from PayMongo. The body is never forwarded. Every request gets 204,
// so the endpoint reveals nothing about which tokens exist.

import { Controller, HttpCode, Param, Post } from "@nestjs/common";
import { getCloudRunAuthorizationHeader } from "@shared/proxy/cloud-run-auth";
import { isApicenterRuntimeEnvironment } from "../../../types";
import { SharedServiceRoutingService } from "./shared-service-routing.service";

const CALLBACK_TOKEN = /^[A-Za-z0-9_-]{43}$/;

@Controller("shared/payment/payout-callbacks")
export class PayoutCallbackController {
  constructor(private readonly sharedServiceRouting: SharedServiceRoutingService) {}

  @Post(":environment/:token")
  @HttpCode(204)
  async forwardPayoutCallback(@Param("environment") environment: string, @Param("token") token: string): Promise<void> {
    if (!isApicenterRuntimeEnvironment(environment) || !CALLBACK_TOKEN.test(token)) return;
    const upstream = this.runtimeUrl(environment);
    const internalToken = (environment === "live"
      ? process.env.APICENTER_PAYMENTS_INTERNAL_TOKEN_LIVE
      : process.env.APICENTER_PAYMENTS_INTERNAL_TOKEN_TEST) || process.env.APICENTER_PAYMENTS_INTERNAL_TOKEN;
    if (!upstream || !internalToken) return;
    const target = `${upstream}/payouts/callbacks/${token}`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-APICenter-Environment": environment,
      "X-APICenter-Internal-Token": internalToken,
    };
    const cloudRunAuthorization = await getCloudRunAuthorizationHeader(target);
    if (cloudRunAuthorization) headers.Authorization = cloudRunAuthorization;
    try {
      await fetch(target, { method: "POST", headers, body: "{}", signal: AbortSignal.timeout(10_000) });
    } catch (error) {
      // The reconcile job settles the payout anyway; a lost callback only delays it.
      console.warn(JSON.stringify({ type: "apicenter_payout_callback_forward_failed", environment, message: (error as Error).message }));
    }
  }

  private runtimeUrl(environment: "test" | "live"): string | undefined {
    const configured = environment === "live"
      ? process.env.SHARED_SERVICE_ROUTE_PAYMENT_LIVE || process.env.APICENTER_PAYMENTS_URL
      : process.env.SHARED_SERVICE_ROUTE_PAYMENT_TEST || process.env.APICENTER_PAYMENTS_URL;
    const target = configured || this.sharedServiceRouting.resolve("payment", environment).targetUrl;
    return target ? target.replace(/\/+$/, "") : undefined;
  }
}
