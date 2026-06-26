const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  collectAdvisorEvidence,
  writeAdvisorEvidence,
  sanitize,
} = require("./collect-supabase-advisor-evidence.js");

function run(name, fn) {
  try {
    fn();
    console.log("ok - " + name);
  } catch (error) {
    console.error("not ok - " + name);
    throw error;
  }
}

function withTempRepo(files, fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "apic-advisor-evidence-"));
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

function fakeRunner(command, args) {
  const joined = [command, ...args].join(" ");
  if (joined === "supabase --version") {
    return { command: joined, status: 0, stdout: "2.105.0\n", stderr: "" };
  }
  if (joined === "supabase db advisors --help") {
    return { command: joined, status: 0, stdout: "Run database advisors\nUsage: supabase db advisors\n", stderr: "" };
  }
  if (joined === "supabase db advisors --linked") {
    return { command: joined, status: 0, stdout: "No security issues found\n", stderr: "" };
  }
  return { command: joined, status: 1, stdout: "", stderr: "unknown command" };
}

run("marks advisor evidence ready when CLI auth, project link, and advisor run are present", () => {
  withTempRepo(
    {
      "supabase/config.toml": "project_id = \"api-center-control-plane\"\n",
      "supabase/.temp/project-ref": "qnebjcboppqdsgmgizvs\n",
    },
    (repoRoot) => {
      const evidence = collectAdvisorEvidence({
        repoRoot,
        now: "2026-06-26T00:00:00.000Z",
        env: {},
        runner: fakeRunner,
        runAdvisors: true,
      });

      assert.equal(evidence.ready, true);
      assert.deepEqual(evidence.blockers, []);
      assert.equal(evidence.supabase.projectRef, "qnebjcboppqdsgmgizvs");
      assert.equal(evidence.cli.advisorsSupported, true);
      assert.equal(evidence.advisorRun.command, "supabase db advisors --linked");
      assert.equal(evidence.advisorRun.status, 0);
      assert.equal(JSON.stringify(evidence).includes("sbp_supersecret"), false);
      assert.equal(JSON.stringify(evidence).includes("db-secret"), false);
    },
  );
});

run("records blockers when advisors cannot be reviewed from the current shell", () => {
  withTempRepo(
    { "supabase/config.toml": "project_id = \"api-center-control-plane\"\n" },
    (repoRoot) => {
      const evidence = collectAdvisorEvidence({
        repoRoot,
        now: "2026-06-26T00:00:00.000Z",
        env: {},
        runner: fakeRunner,
      });

      assert.equal(evidence.ready, false);
      assert.deepEqual(evidence.blockers, [
        "supabase/.temp/project-ref is not present.",
        "supabase db advisors was not run; pass --run-advisors in a live operator shell after Supabase CLI auth and linked pooler metadata are present.",
      ]);
    },
  );
});

run("sanitizes tokens, passwords, and postgres URLs from command output", () => {
  const output = sanitize(
    "token sbp_supersecret password=db-secret url postgresql://user:pass@example/postgres",
    {
      SUPABASE_ACCESS_TOKEN: "sbp_supersecret",
      SUPABASE_DB_PASSWORD: "db-secret",
    },
  );

  assert.equal(output.includes("sbp_supersecret"), false);
  assert.equal(output.includes("db-secret"), false);
  assert.equal(output.includes("postgresql://user"), false);
});

run("writes advisor evidence to disk", () => {
  withTempRepo({}, (repoRoot) => {
    const outPath = path.join(repoRoot, "docs", "operations", "advisors.json");
    const evidence = collectAdvisorEvidence({ repoRoot, env: {}, runner: fakeRunner });
    writeAdvisorEvidence(evidence, outPath);
    const written = JSON.parse(fs.readFileSync(outPath, "utf8"));
    assert.equal(written.cli.advisorsSupported, true);
  });
});
