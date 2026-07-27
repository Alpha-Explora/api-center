const { createSharedServiceApp } = require("@apicenter/runtime");

const port = Number(process.env.PORT || 4010);
const { app } = createSharedServiceApp({
  serviceId: "apicenter-payments",
  health: {
    status: "ok",
    service: "apicenter-payments",
    providerMode: process.env.PAYMENT_PROVIDER_MODE || "mock",
    providerName: process.env.PAYMENT_PROVIDER_NAME || "paymongo",
  },
  jsonOptions: {
    verify: (req, _res, buffer) => {
      req.rawBody = buffer.toString("utf8");
    },
  },
});

const internalToken = process.env.APICENTER_PAYMENTS_INTERNAL_TOKEN;
if (internalToken || process.env.NODE_ENV === "production") {
  app.use((req, res, next) => {
    const supplied = req.get("X-APICenter-Internal-Token");
    if (!internalToken || supplied !== internalToken) {
      res.status(401).json({
        success: false,
        error: { code: "PAYMENTS_INTERNAL_AUTH_REQUIRED", message: "Private payments runtime authentication failed." },
      });
      return;
    }
    next();
  });
}
const { startPaymentEventDispatcher } = require("./events/paymentEventDispatcher");

const paymongoRoutes = require("./routes/paymongo.routes");
app.use("/", paymongoRoutes);

startPaymentEventDispatcher({ intervalMs: Number(process.env.PUBSUB_DISPATCH_INTERVAL_MS || 1000) });

if (require.main === module) {
  app.listen(port, () => {
    console.log(`[apicenter-payments] service listening on port ${port}`);
  });
}

module.exports = { app };


