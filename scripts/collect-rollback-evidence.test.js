const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  collectRollbackEvidence,
  writeRollbackEvidence,
} = require("./collect-rollback-evidence.js");

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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "apic-rollback-evidence-"));
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

run("marks rollback ready when env values and previous image are present", () => {
  withTempRepo(
    {
      "infra/gcp/gke/30-deployment.yaml": "containers:\n  - image: registry.example/api-center:current\n",
    },
    (repoRoot) => {
      const evidence = collectRollbackEvidence({
        repoRoot,
        now: "2026-06-26T00:00:00.000Z",
        env: {
          REGISTRY_SOURCE: "redis",
          DATABASE_DUAL_WRITE: "false",
          DATABASE_ENABLED: "true",
          DATABASE_URL: "postgresql://api_center_app:secret@example.supabase.co/postgres",
        },
        previousImage: "registry.example/api-center:previous",
      });

      assert.equal(evidence.ready, true);
      assert.deepEqual(evidence.blockers, []);
      assert.equal(evidence.environment.REGISTRY_SOURCE.matchesExpected, true);
      assert.equal(evidence.environment.DATABASE_DUAL_WRITE.matchesExpected, true);
      assert.equal(evidence.previousImage.value, "registry.example/api-center:previous");
      assert.equal(evidence.manifestImage.value, "registry.example/api-center:current");
      assert.equal(JSON.stringify(evidence).includes("secret"), false);
    },
  );
});

run("records blockers without leaking values when rollback evidence is incomplete", () => {
  withTempRepo({}, (repoRoot) => {
    const evidence = collectRollbackEvidence({
      repoRoot,
      now: "2026-06-26T00:00:00.000Z",
      env: {
        REGISTRY_SOURCE: "postgres",
        DATABASE_DUAL_WRITE: "true",
      },
    });

    assert.equal(evidence.ready, false);
    assert.deepEqual(evidence.blockers, [
      "REGISTRY_SOURCE must be redis for rollback.",
      "DATABASE_DUAL_WRITE must be false for rollback.",
      "Previous API Center image is not set; provide --previous-image or one of API_CENTER_PREVIOUS_IMAGE, API_CENTER_ROLLBACK_IMAGE, PREVIOUS_API_CENTER_IMAGE, ROLLBACK_IMAGE.",
    ]);
    assert.equal(evidence.environment.REGISTRY_SOURCE.redactedValue, "<present>");
    assert.equal(evidence.environment.DATABASE_DUAL_WRITE.redactedValue, "<present>");
  });
});

run("writes rollback evidence to a requested JSON file", () => {
  withTempRepo({}, (repoRoot) => {
    const outPath = path.join(repoRoot, "docs", "operations", "rollback.json");
    const evidence = collectRollbackEvidence({
      repoRoot,
      now: "2026-06-26T00:00:00.000Z",
      env: {},
    });

    writeRollbackEvidence(evidence, outPath);

    const written = JSON.parse(fs.readFileSync(outPath, "utf8"));
    assert.equal(written.environment.REGISTRY_SOURCE.present, false);
    assert.equal(written.previousImage.present, false);
  });
});
