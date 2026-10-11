import { readFileSync, existsSync, readdirSync } from "node:fs";
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
  assert.match(home, /APICenter/);
  assert.match(home, /REST API/);

  const api = page("reference/api");
  assert.match(api, /Idempotency/);
  assert.match(api, /\/api\/v1\/payments\/checkouts/);

  const events = page("reference/events");
  assert.match(events, /payment\.checkout\.paid/);
  assert.match(events, /payment\.checkout\.created/);

  const paymentLimits = page("guides/payments/limits");
  assert.match(paymentLimits, /AMOUNT_LIMIT_EXCEEDED/);
  assert.match(paymentLimits, /PAYMENT_RATE_LIMIT_EXCEEDED/);
  assert.match(paymentLimits, /payments\.live_access/);

  // Each operation has its own static page
  assert.ok(
    existsSync(join(output, "reference", "api", "createCheckout", "index.html")),
    "createCheckout endpoint page should be exported"
  );
  const endpointPage = page("reference/api/createCheckout");
  assert.match(endpointPage, /Idempotency-Key/);
  assert.match(endpointPage, /Authentication/);
});

test("every canonical guide, alias, and legacy bookmark is exported", () => {
  const registry: { slug: string; aliases?: string[] }[] = JSON.parse(readFileSync("content/guides.json", "utf8"));
  for (const guide of registry) {
    for (const slug of [guide.slug, ...(guide.aliases ?? [])]) {
      assert.ok(existsSync(join(output, "guides", slug, "index.html")), `missing published guide: ${slug}`);
    }
  }
  const legacy: Record<string, string> = JSON.parse(readFileSync("content/legacy-reference.json", "utf8"));
  for (const [operationId, guide] of Object.entries(legacy)) {
    assert.ok(page(`reference/api/${operationId}`).includes(`/guides/${guide}`), `missing legacy guide handoff: ${operationId}`);
  }
});

test("native MDX publishes links and tables without exposing metadata", () => {
  const overview = page("guides/payments/overview");
  assert.match(overview, /href="\/guides\/payments\/payment-links\/?"/);
  const auth = page("guides/authentication");
  assert.equal((auth.match(/<h1[ >]/g) ?? []).length, 1, "the guide should have one page title");
  assert.match(auth, /<table[ >]/);
  assert.doesNotMatch(auth, /<p[^>]*>title:/);
  assert.doesNotMatch(auth, /Fumadocs Solar Preset Guide/);
});

test("payment reference publishes API-key authentication and declared statuses", () => {
  const checkout = page("reference/api/createCheckout");
  assert.match(checkout, /PAYMENT_API_KEY/);
  assert.match(checkout, /Checkout created/);
  assert.match(checkout, /Provider outcome is pending confirmation/);
  assert.match(checkout, />201<|>201<!--/);
  assert.match(checkout, />202<|>202<!--/);
  assert.match(checkout, />409<|>409<!--/);
  assert.doesNotMatch(checkout, /@apicenter\/sdk/);
  assert.doesNotMatch(page("reference/api/getCheckout"), /Query parameters/);
});

test("all local links in exported HTML resolve to an exported file", () => {
  const htmlFiles = (directory: string): string[] => readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? htmlFiles(join(directory, entry.name)) : entry.name.endsWith(".html") ? [join(directory, entry.name)] : [],
  );
  for (const file of htmlFiles(output)) {
    const html = readFileSync(file, "utf8");
    for (const match of html.matchAll(/href="([^"]+)"/g)) {
      const href = match[1].replace(/&amp;/g, "&");
      if (!href.startsWith("/") || href.startsWith("//")) continue;
      const target = decodeURIComponent(new URL(href, "https://docs.example.test").pathname).replace(/^\//, "");
      assert.ok(existsSync(join(output, target)) || existsSync(join(output, target, "index.html")), `${file}: broken exported link ${href}`);
    }
  }
});
