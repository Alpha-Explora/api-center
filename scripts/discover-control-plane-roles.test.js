const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { collectRoleDiscoveryEvidence, writeRoleDiscoveryEvidence } = require("./discover-control-plane-roles.js");

function run(name, fn) {
  Promise.resolve()
    .then(fn)
    .then(() => console.log("ok - " + name))
    .catch((error) => {
      console.error("not ok - " + name);
      console.error(error);
      process.exitCode = 1;
    });
}

function fakeClient(rows) {
  return {
    connected: false,
    ended: false,
    async connect() { this.connected = true; },
    async end() { this.ended = true; },
    async query(sql, params) {
      if (/select current_user as current_user/i.test(sql)) {
        return { rows: [{ current_user: "api_center_app", session_user: "api_center_app" }] };
      }
      assert.match(sql, /information_schema.role_table_grants/);
      assert.deepEqual(params, [["api_center", "api_center_ops", "api_center_audit", "apic_catalog", "apic_governance", "apic_runtime", "apic_audit"]]);
      return { rows };
    },
  };
}

run("aggregates runtime role grants and excludes built-in Supabase roles", async () => {
  const client = fakeClient([
    { table_schema: "api_center", grantee: "api_center_app", privilege_type: "SELECT" },
    { table_schema: "api_center", grantee: "api_center_app", privilege_type: "INSERT" },
    { table_schema: "apic_runtime", grantee: "api_center_app", privilege_type: "UPDATE" },
    { table_schema: "apic_audit", grantee: "analytics_reader", privilege_type: "SELECT" },
    { table_schema: "apic_audit", grantee: "postgres", privilege_type: "SELECT" },
    { table_schema: "apic_audit", grantee: "anon", privilege_type: "SELECT" },
  ]);

  const evidence = await collectRoleDiscoveryEvidence({
    databaseUrl: "postgresql://api_center_app:super-secret@example/postgres",
    now: "2026-06-26T00:00:00.000Z",
    clientFactory: () => client,
  });

  assert.equal(evidence.generatedAt, "2026-06-26T00:00:00.000Z");
  assert.equal(evidence.databaseUrl.present, true);
  assert.equal(evidence.databaseUrl.redactedValue, "<present>");
  assert.equal(JSON.stringify(evidence).includes("super-secret"), false);
  assert.deepEqual(evidence.roles.map((role) => role.grantee), ["analytics_reader", "api_center_app"]);
  assert.deepEqual(evidence.roles.find((role) => role.grantee === "api_center_app").schemas, [
    { schema: "api_center", privileges: ["INSERT", "SELECT"] },
    { schema: "apic_runtime", privileges: ["UPDATE"] },
  ]);
  assert.deepEqual(evidence.recommendedAppRoles, ["api_center_app"]);
  assert.equal(evidence.connectionRole.currentUser, "api_center_app");
  assert.deepEqual(evidence.reviewRequired, [
    "analytics_reader has SELECT-only grants and should be reviewed as reporting/read-only, not app runtime.",
  ]);
  assert.equal(client.connected, true);
  assert.equal(client.ended, true);
});

run("blocks privileged built-in database URL users", async () => {
  const client = {
    async connect() {},
    async end() {},
    async query(sql) {
      if (/select current_user as current_user/i.test(sql)) {
        return { rows: [{ current_user: "postgres", session_user: "postgres" }] };
      }
      return { rows: [] };
    },
  };

  const evidence = await collectRoleDiscoveryEvidence({
    databaseUrl: "postgresql://postgres.project_ref:super-secret@example/postgres",
    now: "2026-06-26T00:00:00.000Z",
    clientFactory: () => client,
  });

  assert.equal(evidence.connectionRole.urlUser, "postgres");
  assert.equal(evidence.connectionRole.currentUser, "postgres");
  assert.equal(evidence.blockers.some((blocker) => blocker.includes("built-in privileged role postgres")), true);
});

run("uses linked Supabase query when DATABASE_URL is missing", async () => {
  const evidence = await collectRoleDiscoveryEvidence({
    databaseUrl: "",
    now: "2026-06-26T00:00:00.000Z",
    runner: (command, args) => ({
      command: [command, ...args].join(" "),
      status: 0,
      stdout: JSON.stringify({ rows: [
        { table_schema: "apic_runtime", grantee: "api_center_app", privilege_type: "INSERT" },
        { table_schema: "apic_runtime", grantee: "api_center_app", privilege_type: "SELECT" },
        { table_schema: "apic_audit", grantee: "analytics_reader", privilege_type: "SELECT" },
      ] }),
      stderr: "",
    }),
  });
  assert.equal(evidence.databaseUrl.present, false);
  assert.equal(evidence.linkedQueryRun.command.includes("supabase db query --linked"), true);
  assert.deepEqual(evidence.recommendedAppRoles, ["api_center_app"]);
  assert.deepEqual(evidence.blockers, []);
});

run("reports missing DATABASE_URL when linked query also fails", async () => {
  const evidence = await collectRoleDiscoveryEvidence({
    databaseUrl: "",
    now: "2026-06-26T00:00:00.000Z",
    runner: (command, args) => ({ command: [command, ...args].join(" "), status: 1, stdout: "", stderr: "network failed" }),
  });
  assert.deepEqual(evidence.roles, []);
  assert.deepEqual(evidence.blockers, ["DATABASE_URL is not set and supabase db query --linked did not complete successfully."]);
});

run("writes role discovery evidence to disk", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "apic-role-discovery-"));
  try {
    const outPath = path.join(dir, "roles.json");
    writeRoleDiscoveryEvidence({ generatedAt: "now", roles: [] }, outPath);
    assert.equal(JSON.parse(fs.readFileSync(outPath, "utf8")).generatedAt, "now");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
