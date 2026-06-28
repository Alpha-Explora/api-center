const assert = require("node:assert/strict");
const {
  collectLegacySecretCandidates,
  evaluateDeletionCandidate,
  summarizeVersionStates,
} = require("./delete-legacy-secret-records.js");

function run(name, fn) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

run("collects unique legacy secret candidates from plan and applied evidence", () => {
  const candidates = collectLegacySecretCandidates({
    deleteAfter: "2026-07-04T22:30:06.543Z",
    legacyDisablePlan: [
      {
        name: "api-center-test-tribe-secret-pakiapps",
        kind: "test_prefixed",
        disposition: "active_service_scoped_targets_ready_or_created",
      },
    ],
    applied: {
      legacyVersionsDisabled: [
        {
          name: "api-center-test-tribe-secret-pakiapps",
          version: "1",
          deleteAfter: "2026-07-04T22:30:06.543Z",
        },
        {
          name: "api-center-tribe-secret-old-service",
          version: "1",
          deleteAfter: "2026-07-05T00:00:00.000Z",
        },
      ],
    },
  });

  assert.deepEqual(
    candidates.map((candidate) => candidate.name),
    [
      "api-center-test-tribe-secret-pakiapps",
      "api-center-tribe-secret-old-service",
    ],
  );
  assert.equal(candidates[0].deleteAfter, "2026-07-04T22:30:06.543Z");
  assert.equal(candidates[1].disposition, "disabled_by_previous_cleanup");
});

run("blocks deletion before rollback window closes", () => {
  const decision = evaluateDeletionCandidate({
    candidate: {
      deleteAfter: "2026-07-04T22:30:06.543Z",
    },
    inspection: {
      exists: true,
      versions: [{ version: "1", state: "DISABLED" }],
    },
    now: new Date("2026-06-28T00:00:00.000Z"),
  });

  assert.equal(decision.readyToDelete, false);
  assert.deepEqual(decision.blockers, [
    "rollback window is open until 2026-07-04T22:30:06.543Z",
  ]);
});

run("allows early deletion waiver only for the rollback-window blocker", () => {
  const decision = evaluateDeletionCandidate({
    candidate: {
      deleteAfter: "2026-07-04T22:30:06.543Z",
    },
    inspection: {
      exists: true,
      versions: [{ version: "1", state: "DISABLED" }],
    },
    now: new Date("2026-06-28T00:00:00.000Z"),
    apply: true,
    confirmed: true,
    earlyDeleteWaiver: true,
  });

  assert.equal(decision.readyToDelete, true);
  assert.deepEqual(decision.blockers, []);
  assert.deepEqual(decision.waivedBlockers, [
    "rollback window is open until 2026-07-04T22:30:06.543Z",
  ]);
});

run("early deletion waiver does not bypass enabled-version blocker", () => {
  const decision = evaluateDeletionCandidate({
    candidate: {
      deleteAfter: "2026-07-04T22:30:06.543Z",
    },
    inspection: {
      exists: true,
      versions: [
        { version: "1", state: "DISABLED" },
        { version: "2", state: "ENABLED" },
      ],
    },
    now: new Date("2026-06-28T00:00:00.000Z"),
    apply: true,
    confirmed: true,
    earlyDeleteWaiver: true,
  });

  assert.equal(decision.readyToDelete, false);
  assert.deepEqual(decision.blockers, ["1 enabled version(s) still exist"]);
  assert.deepEqual(decision.waivedBlockers, [
    "rollback window is open until 2026-07-04T22:30:06.543Z",
  ]);
});

run("blocks deletion when any legacy version is still enabled", () => {
  const decision = evaluateDeletionCandidate({
    candidate: {
      deleteAfter: "2026-07-04T22:30:06.543Z",
    },
    inspection: {
      exists: true,
      versions: [
        { version: "1", state: "DISABLED" },
        { version: "2", state: "ENABLED" },
      ],
    },
    now: new Date("2026-07-05T00:00:00.000Z"),
    apply: true,
    confirmed: true,
  });

  assert.equal(decision.readyToDelete, false);
  assert.deepEqual(decision.blockers, ["1 enabled version(s) still exist"]);
});

run("requires explicit confirmation in apply mode", () => {
  const decision = evaluateDeletionCandidate({
    candidate: {
      deleteAfter: "2026-07-04T22:30:06.543Z",
    },
    inspection: {
      exists: true,
      versions: [{ version: "1", state: "DISABLED" }],
    },
    now: new Date("2026-07-05T00:00:00.000Z"),
    apply: true,
    confirmed: false,
  });

  assert.equal(decision.readyToDelete, false);
  assert.deepEqual(decision.blockers, [
    "apply mode requires --confirm-delete-disabled-legacy-secrets",
  ]);
});

run("allows deletion only after window with disabled versions and confirmation", () => {
  const decision = evaluateDeletionCandidate({
    candidate: {
      deleteAfter: "2026-07-04T22:30:06.543Z",
    },
    inspection: {
      exists: true,
      versions: [{ version: "1", state: "DISABLED" }],
    },
    now: new Date("2026-07-05T00:00:00.000Z"),
    apply: true,
    confirmed: true,
  });

  assert.equal(decision.readyToDelete, true);
  assert.deepEqual(decision.blockers, []);
});

run("treats already-deleted records as non-blocking after rollback window", () => {
  const decision = evaluateDeletionCandidate({
    candidate: {
      deleteAfter: "2026-07-04T22:30:06.543Z",
    },
    inspection: {
      exists: false,
      versions: [],
    },
    now: new Date("2026-07-05T00:00:00.000Z"),
    apply: true,
    confirmed: true,
  });

  assert.equal(decision.readyToDelete, false);
  assert.deepEqual(decision.blockers, []);
});

run("summarizes Secret Manager version states", () => {
  assert.deepEqual(
    summarizeVersionStates([
      { version: "1", state: "DISABLED" },
      { version: "2", state: "DISABLED" },
      { version: "3", state: "DESTROYED" },
    ]),
    { DISABLED: 2, DESTROYED: 1 },
  );
});
