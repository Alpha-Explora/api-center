import { readFileSync } from "node:fs";
import { join } from "node:path";

// apps/webhooks answers Pub/Sub before it writes the delivery history, so the write runs after the
// response. Cloud Run throttles CPU after the response by default, and a cold instance then timed out
// connecting to Postgres: Serbizio's first live payment delivery (2026-11-21) never reached the history.
describe("apicenter-webhooks-live manifest", () => {
  it("keeps CPU allocated after the response", () => {
    const manifest = JSON.parse(
      readFileSync(join(__dirname, "../../../../infra/gcp/cloud-run/workspace/apicenter-webhooks-live.json"), "utf8"),
    );

    expect(manifest.spec.template.metadata.annotations["run.googleapis.com/cpu-throttling"]).toBe("false");
  });
});
