const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  collectLivePreflightEvidence,
  writeLivePreflightEvidence,
  parseProjectRefFromUrl,
} = require("./live-migration-preflight.js");

function run(name, fn) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

function withTempRepo(files, fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "apic-live-preflight-"));
  try {
    for (const [relPath, content] of Object.entries(files)) {
      const target = path.join(root, relPath);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content, "utf8");
    }
    return fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

run("collects project and env presence without leaking secret values", () => {
  withTempRepo(
    {
      "supabase/config.toml": 'project_id = "api-center-control-plane"\n',
      "supabase/.temp/project-ref": "qnebjcboppqdsgmgizvs\n",
    },
    (repoRoot) => {
      const evidence = collectLivePreflightEvidence({
        repoRoot,
        now: "2026-06-26T00:00:00.000Z",
        env: {
          DATABASE_URL:
            "postgresql://api_center_app:secret@example.supabase.co:5432/postgres",
          DATABASE_ENABLED: "true",
          REGISTRY_SOURCE: "postgres",
          SUPABASE_DB_PASSWORD: "super-secret-password",
        },
      });

      assert.equal(evidence.generatedAt, "2026-06-26T00:00:00.000Z");
      assert.equal(evidence.supabase.projectRef, "qnebjcboppqdsgmgizvs");
      assert.equal(evidence.supabase.configProjectId, "api-center-control-plane");
      assert.equal(evidence.environment.DATABASE_URL.present, true);
      assert.equal(evidence.environment.DATABASE_URL.redactedValue, "<present>");
      assert.equal(evidence.environment.SUPABASE_DB_PASSWORD.present, true);
      assert.equal(
        JSON.stringify(evidence),
        JSON.stringify(evidence).replace("super-secret-password", ""),
      );
      assert.deepEqual(evidence.blockers, [
        "DATABASE_DUAL_WRITE is not set",
        "REGISTRY_DUAL_WRITE is not set",
        "SUPABASE_TARGET_PROJECT_REF or EXPECTED_SUPABASE_PROJECT_REF is not set",
        "APICENTER_ENVIRONMENT_NAME or SUPABASE_TARGET_ENVIRONMENT is not set",
      ]);
    },
  );
});

run("writes preflight evidence to a requested JSON file", () => {
  withTempRepo({ "supabase/config.toml": 'project_id = "local"\n' }, (repoRoot) => {
    const outPath = path.join(repoRoot, "docs", "operations", "preflight.json");
    const evidence = collectLivePreflightEvidence({
      repoRoot,
      now: "2026-06-26T00:00:00.000Z",
      env: {},
    });

    writeLivePreflightEvidence(evidence, outPath);

    const written = JSON.parse(fs.readFileSync(outPath, "utf8"));
    assert.equal(written.supabase.configProjectId, "local");
    assert.equal(written.environment.DATABASE_URL.present, false);
  });
});

run("captures matching target project and environment confirmation", () => {
  withTempRepo(
    {
      "supabase/config.toml": 'project_id = "api-center-control-plane"\n',
      "supabase/.temp/project-ref": "qnebjcboppqdsgmgizvs\n",
    },
    (repoRoot) => {
      const evidence = collectLivePreflightEvidence({
        repoRoot,
        now: "2026-06-26T00:00:00.000Z",
        env: {
          SUPABASE_TARGET_PROJECT_REF: "qnebjcboppqdsgmgizvs",
          APICENTER_ENVIRONMENT_NAME: "test",
        },
      });

      assert.equal(evidence.target.expectedProjectRef, "qnebjcboppqdsgmgizvs");
      assert.equal(evidence.target.environmentName, "test");
      assert.equal(
        evidence.blockers.includes(
          "Expected target project ref qnebjcboppqdsgmgizvs does not match linked Supabase project ref qnebjcboppqdsgmgizvs.",
        ),
        false,
      );
    },
  );
});

run("captures Codex Supabase MCP project ref from env without leaking URL credentials", () => {
  withTempRepo(
    {
      "supabase/config.toml": 'project_id = "api-center-control-plane"\n',
      "supabase/.temp/project-ref": "qnebjcboppqdsgmgizvs\n",
    },
    (repoRoot) => {
      const evidence = collectLivePreflightEvidence({
        repoRoot,
        now: "2026-06-26T00:00:00.000Z",
        env: {
          CODEX_SUPABASE_MCP_URL:
            "https://mcp.supabase.com/mcp?project_ref=hguyivbodlrmooayuxwt&token=do-not-store",
        },
      });

      assert.equal(evidence.supabase.codexMcpProjectRef, "hguyivbodlrmooayuxwt");
      assert.equal(
        evidence.blockers.includes(
          "Codex Supabase MCP project ref hguyivbodlrmooayuxwt does not match linked Supabase project ref qnebjcboppqdsgmgizvs.",
        ),
        true,
      );
      assert.equal(JSON.stringify(evidence).includes("do-not-store"), false);
    },
  );
});

run("parses project_ref from Supabase MCP URLs", () => {
  assert.equal(
    parseProjectRefFromUrl("https://mcp.supabase.com/mcp?project_ref=hguyivbodlrmooayuxwt"),
    "hguyivbodlrmooayuxwt",
  );
  assert.equal(parseProjectRefFromUrl("not a url?project_ref=abc123&x=1"), "abc123");
});
