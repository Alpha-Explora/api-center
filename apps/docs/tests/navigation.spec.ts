import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

const output = join(process.cwd(), "out");

function page(route: string) {
  return readFileSync(join(output, route, "index.html"), "utf8");
}

test("static docs publish the contract-backed navigation and references", () => {
  assert.ok(existsSync(join(output, "index.html")), "home page should be exported");
  const home = page("");
  assert.match(home, /Getting Started/);
  assert.match(home, /payment\.checkout\.paid/);

  const api = page("reference/api");
  assert.match(api, /Idempotency-Key/);
  assert.match(api, /\/api\/v1\/payments\/checkouts/);

  const events = page("reference/events");
  assert.match(events, /payment\.checkout\.paid/);
  assert.match(events, /payment\.checkout\.created/);
});