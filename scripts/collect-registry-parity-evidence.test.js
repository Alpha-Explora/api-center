const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { collectRegistryParityEvidence, compareRegistryEntries, writeRegistryParityEvidence, sanitize } = require("./collect-registry-parity-evidence.js");

async function run(name, fn) {
  try {
    await fn();
    console.log("ok - " + name);
  } catch (error) {
    console.error("not ok - " + name);
    throw error;
  }
}

function withTempRepo(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "apic-registry-parity-"));
  try { return fn(root); } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

const service = {
  serviceId: "orders-api",
  name: "Orders API",
  baseUrl: "https://orders.example.com",
  status: "active",
  exposes: ["/orders"],
  requiredScopes: ["orders:read"],
  consumes: ["payments-api"],
  ownerTribeId: "orders",
  version: "1.0.0",
  registeredAt: "2026-06-01T00:00:00.000Z",
  updatedAt: "2026-06-01T00:00:00.000Z",
  environments: [{ environment: "test", baseUrl: "https://orders.example.com", status: "active" }],
};

(async () => {
  await run("compares matching Redis and Postgres registry projections", async () => {
    const parity = compareRegistryEntries({ "orders-api": service }, { "orders-api": service });
    assert.equal(parity.matches, true);
    assert.equal(parity.counts.redis, 1);
    assert.equal(parity.counts.postgres, 1);
  });

  await run("detects missing and mismatched registry entries", async () => {
    const parity = compareRegistryEntries(
      { "orders-api": service, "payments-api": { ...service, serviceId: "payments-api", name: "Payments" } },
      { "orders-api": { ...service, name: "Orders API v2" }, "catalog-api": { ...service, serviceId: "catalog-api", name: "Catalog" } },
    );
    assert.equal(parity.matches, false);
    assert.deepEqual(parity.missingInPostgres, ["payments-api"]);
    assert.deepEqual(parity.missingInRedis, ["catalog-api"]);
    assert.equal(parity.mismatches[0].serviceId, "orders-api");
  });

  await run("records blockers without live env and does not run loaders", async () => {
    let called = false;
    const evidence = await collectRegistryParityEvidence({ repoRoot: "C:/repo", env: {}, redisLoader: async () => { called = true; return {}; }, postgresLoader: async () => { called = true; return {}; } });
    assert.equal(called, false);
    assert.equal(evidence.ready, false);
    assert.equal(evidence.blockers.includes("DATABASE_URL is not set."), true);
    assert.equal(evidence.blockers.some((blocker) => blocker.includes("Redis URL or API Center admin registry snapshot credentials")), true);
  });

  await run("runs parity loaders when live env exists", async () => {
    const evidence = await collectRegistryParityEvidence({ repoRoot: "C:/repo", env: { DATABASE_URL: "postgresql://user:secret@example/postgres", REDIS_CACHE_URL: "redis://:secret@example:6379" }, redisLoader: async () => ({ "orders-api": service }), postgresLoader: async () => ({ "orders-api": service }) });
    assert.equal(evidence.ready, true);
    assert.equal(evidence.parity.matches, true);
    assert.equal(JSON.stringify(evidence).includes("postgresql://user"), false);
    assert.equal(JSON.stringify(evidence).includes("redis://"), false);
  });

  await run("falls back to API Center registry snapshot when Redis is unreachable", async () => {
    const evidence = await collectRegistryParityEvidence({
      repoRoot: "C:/repo",
      env: {
        DATABASE_URL: "postgresql://user:secret@example/postgres",
        REDIS_CACHE_URL: "redis://:secret@example:6379",
        API_CENTER_BASE_URL: "https://api-center.example.com",
        API_CENTER_PLATFORM_ADMIN_SECRET: "admin-secret",
      },
      redisLoader: async () => { throw new Error("redis://:secret@example:6379 unavailable"); },
      apiLoader: async () => ({ "orders-api": service }),
      postgresLoader: async () => ({ "orders-api": service }),
    });
    assert.equal(evidence.ready, true);
    assert.equal(evidence.source, "api_center_registry");
    assert.equal(evidence.parity.matches, true);
    assert.equal(JSON.stringify(evidence).includes("admin-secret"), false);
    assert.equal(JSON.stringify(evidence).includes("redis://"), false);
  });

  await run("records loader failures as blockers", async () => {
    const evidence = await collectRegistryParityEvidence({ repoRoot: "C:/repo", env: { DATABASE_URL: "postgresql://user:secret@example/postgres", REDIS_CACHE_URL: "redis://:secret@example:6379" }, redisLoader: async () => { throw new Error("redis://:secret@example:6379 unavailable"); }, postgresLoader: async () => ({}) });
    assert.equal(evidence.ready, false);
    assert.equal(evidence.blockers.some((blocker) => blocker.includes("Registry parity check failed")), true);
    assert.equal(JSON.stringify(evidence).includes("redis://"), false);
  });

  await run("writes registry parity evidence to disk", async () => {
    await withTempRepo(async (repoRoot) => {
      const outPath = path.join(repoRoot, "docs", "operations", "registry-parity.json");
      const evidence = await collectRegistryParityEvidence({ repoRoot, env: {} });
      writeRegistryParityEvidence(evidence, outPath);
      const written = JSON.parse(fs.readFileSync(outPath, "utf8"));
      assert.equal(written.redis.key, "api-center:registry:services");
    });
  });

  await run("sanitizes database and redis urls", async () => {
    const output = sanitize("postgresql://user:secret@example/postgres redis://:secret@example:6379 Bearer abc.def password=secret2 topvalue", { DATABASE_URL: "postgresql://user:secret@example/postgres", REDIS_CACHE_URL: "redis://:secret@example:6379", API_CENTER_PLATFORM_ADMIN_SECRET: "topvalue" });
    assert.equal(output.includes("postgresql://user"), false);
    assert.equal(output.includes("redis://"), false);
    assert.equal(output.includes("abc.def"), false);
    assert.equal(output.includes("topvalue"), false);
    assert.equal(output.includes("secret2"), false);
  });
})();
