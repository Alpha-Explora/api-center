const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { Pool } = require("pg");
const url = process.env.APICENTER_OPERABILITY_TEST_URL;
const PaymentReplayStore = url
  ? require("../../apps/payments/dist/events/paymentReplayStore")
      .PaymentReplayStore
  : null;
const skip = url
  ? false
  : "APICENTER_OPERABILITY_TEST_URL must name the disposable local test database";
if (url) {
  const parsed = new URL(url);
  if (
    !["127.0.0.1", "localhost"].includes(parsed.hostname) ||
    parsed.pathname !== "/apicenter_test"
  )
    throw new Error(
      "Refusing nonlocal or nondedicated operability test database",
    );
}
const pool = url ? new Pool({ connectionString: url, max: 6 }) : null;
const context = {
  tribeId: "operability-test",
  projectId: "operability-test",
  consumerServiceId: "operability-consumer",
  environment: "test",
};
const eventIds = [];
test.before(async () => {
  if (!pool) return;
  await pool.query(
    "CREATE TABLE IF NOT EXISTS public.operability_test_migrations(name text PRIMARY KEY)",
  );
  const files = fs
    .readdirSync(path.resolve(__dirname, "../../supabase/migrations"))
    .filter((name) => name.startsWith("20261113") && name.endsWith(".sql"))
    .sort();
  for (const name of files) {
    if (
      (
        await pool.query(
          "SELECT 1 FROM public.operability_test_migrations WHERE name=$1",
          [name],
        )
      ).rows.length
    )
      continue;
    await pool.query(
      fs.readFileSync(
        path.resolve(__dirname, "../../supabase/migrations", name),
        "utf8",
      ),
    );
    await pool.query(
      "INSERT INTO public.operability_test_migrations VALUES ($1)",
      [name],
    );
  }
});
test.after(async () => {
  if (pool) {
    for (const id of eventIds)
      await pool.query(
        "DELETE FROM shared_payment.payment_event_outbox WHERE id=$1",
        [id],
      );
    await pool.end();
  }
});
async function event() {
  const id = randomUUID();
  eventIds.push(id);
  await pool.query(
    `INSERT INTO shared_payment.payment_event_outbox(id,environment,project_id,provider_event_id,event_type,aggregate_type,aggregate_id,aggregate_version,payload,owner_tribe_id,consumer_service_id) VALUES ($1,'test',$2,$3,'payment.checkout.paid','checkout','chk_original',4,$4::jsonb,$5,$6)`,
    [
      id,
      context.projectId,
      "provider-" + id,
      JSON.stringify({
        ownerTribeId: context.tribeId,
        consumerServiceId: context.consumerServiceId,
        referenceId: "test-order",
        status: "paid",
        amount: { amountMinor: 100, currency: "PHP" },
        occurredAt: "2026-11-13T00:00:00.000Z",
      }),
      context.tribeId,
      context.consumerServiceId,
    ],
  );
  return id;
}
test(
  "the additive migration chain creates evidence, receipt and diagnostic tables",
  { skip },
  async () => {
    const rows = await pool.query(
      "SELECT table_schema,table_name FROM information_schema.tables WHERE table_name IN ('verification_reports','payment_credential_operations','request_diagnostics','payment_replay_attempts')",
    );
    assert.equal(rows.rowCount, 4);
  },
);

test(
  "the server default replay store opens its own payment database pool",
  { skip },
  async () => {
    const previous = process.env.SHARED_SERVICES_DATABASE_URL;
    process.env.SHARED_SERVICES_DATABASE_URL = url;
    const store = new PaymentReplayStore();
    try {
      assert.deepEqual(
        await store.list({ ...context, consumerServiceId: "no-events" }),
        [],
      );
    } finally {
      await store.close();
      if (previous === undefined)
        delete process.env.SHARED_SERVICES_DATABASE_URL;
      else process.env.SHARED_SERVICES_DATABASE_URL = previous;
    }
  },
);
test(
  "concurrent replay requests converge on one publication with original identity",
  { skip },
  async () => {
    const id = await event();
    const calls = [];
    const store = new PaymentReplayStore({
      pool,
      publish: async (event) => {
        calls.push(event);
        return { published: true, messageId: "message-1" };
      },
    });
    const input = {
      eventId: id,
      operationId: randomUUID(),
      actor: "test-operator",
      reason: "Verified consumer recovery",
      context,
    };
    const results = await Promise.all([
      store.replay(input),
      store.replay(input),
    ]);
    assert.equal(calls.length, 1);
    assert.equal(results[0].attemptId, results[1].attemptId);
    assert.equal(calls[0].aggregateVersion, 4);
    assert.equal(calls[0].providerEventId, "provider-" + id);
    assert.equal(calls[0].payload.occurredAt, "2026-11-13T00:00:00.000Z");
    const retry = await store.replay(input);
    assert.equal(retry.status, "published");
    assert.equal(calls.length, 1);
  },
);
test(
  "uncertain publication blocks a new operation and other-tenant replay is denied",
  { skip },
  async () => {
    const id = await event();
    let calls = 0;
    const store = new PaymentReplayStore({
      pool,
      publish: async () => {
        calls++;
        throw new Error("Uncertain provider result");
      },
    });
    const input = {
      eventId: id,
      operationId: randomUUID(),
      actor: "test-operator",
      reason: "Investigated delivery",
      context,
    };
    assert.equal((await store.replay(input)).status, "uncertain");
    await assert.rejects(
      store.replay({ ...input, operationId: randomUUID() }),
      { code: "REPLAY_REQUIRES_RECONCILIATION" },
    );
    await assert.rejects(
      store.replay({
        ...input,
        context: { ...context, projectId: "another-project" },
      }),
      { code: "PAYMENT_EVENT_NOT_FOUND" },
    );
    assert.equal(calls, 1);
  },
);
