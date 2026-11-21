// Where the private payments runtime for an environment lives, and the token it accepts. Shared by the
// public payments facade and the console's payout pages.

export function paymentRuntimeUrl(environment: "test" | "live"): string {
  const configured =
    process.env.APICENTER_PAYMENTS_URL ||
    (environment === "live"
      ? process.env.SHARED_SERVICE_ROUTE_PAYMENT_LIVE
      : process.env.SHARED_SERVICE_ROUTE_PAYMENT_TEST) ||
    "http://localhost:4010";
  return configured.replace(/\/$/, "");
}

export function paymentRuntimeToken(environment: "test" | "live"): string | undefined {
  return (
    (environment === "live"
      ? process.env.APICENTER_PAYMENTS_INTERNAL_TOKEN_LIVE
      : process.env.APICENTER_PAYMENTS_INTERNAL_TOKEN_TEST) ||
    process.env.APICENTER_PAYMENTS_INTERNAL_TOKEN
  );
}
