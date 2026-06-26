#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const MIGRATION_PATH = "supabase/migrations/20260625162216_enterprise_control_plane_schemas.sql";
const COMPATIBILITY_VIEW_NAMES = [
  "api_center.organizations",
  "api_center.services",
  "api_center.service_environments",
  "api_center.service_routes",
  "api_center.service_scopes",
  "api_center.service_dependencies",
  "api_center.service_lifecycle_events",
  "api_center.tribe_secret_refs",
  "api_center.confluent_topics",
  "api_center.s3_sink_topics",
  "api_center_ops.service_registration_requests",
  "api_center_ops.approval_requests",
  "api_center_ops.tribe_api_quota_policies",
  "api_center_ops.tribe_plan_definitions",
  "api_center_ops.tribe_plan_assignments",
  "api_center_ops.provisioning_jobs",
  "api_center_ops.topic_onboarding_states",
  "api_center_ops.health_snapshots",
  "api_center_ops.smoke_test_runs",
  "api_center_ops.usage_rollups",
  "api_center_ops.tribe_api_quota_decisions",
  "api_center_ops.pipeline_feedback_actions",
  "api_center_audit.audit_events",
];
const VALID_STRATEGIES = new Set(["compatibility_views", "controlled_window"]);

function collectRolloutStrategyEvidence({
  repoRoot = path.resolve(__dirname, ".."),
  env = process.env,
  now = new Date().toISOString(),
} = {}) {
  const strategy = normalize(env.APICENTER_MIGRATION_ROLLOUT_STRATEGY || env.SUPABASE_MIGRATION_ROLLOUT_STRATEGY);
  const compatibilityViewsApproved = readBoolean(env.APICENTER_COMPATIBILITY_VIEWS_APPROVED || env.COMPATIBILITY_VIEWS_APPROVED);
  const controlledWindowApproved = readBoolean(env.APICENTER_CONTROLLED_MIGRATION_WINDOW_APPROVED || env.CONTROLLED_MIGRATION_WINDOW_APPROVED);
  const controlledWindow = {
    start: normalize(env.APICENTER_MIGRATION_WINDOW_START || env.MIGRATION_WINDOW_START),
    end: normalize(env.APICENTER_MIGRATION_WINDOW_END || env.MIGRATION_WINDOW_END),
  };
  const compatibilityViews = inspectCompatibilityViews(path.join(repoRoot, MIGRATION_PATH));
  const blockers = [];

  if (!strategy) blockers.push("APICENTER_MIGRATION_ROLLOUT_STRATEGY or SUPABASE_MIGRATION_ROLLOUT_STRATEGY is not set.");
  else if (!VALID_STRATEGIES.has(strategy)) blockers.push("Migration rollout strategy must be compatibility_views or controlled_window.");

  if (strategy === "compatibility_views") {
    if (compatibilityViewsApproved !== true) blockers.push("Compatibility-view rollout is not approved; set APICENTER_COMPATIBILITY_VIEWS_APPROVED=true.");
    if (!compatibilityViews.present) blockers.push("Enterprise migration SQL is missing: " + MIGRATION_PATH + ".");
    for (const view of compatibilityViews.missing) blockers.push("Missing compatibility view: " + view + ".");
    for (const view of compatibilityViews.missingSecurityInvoker) blockers.push("Compatibility view is missing security_invoker=true: " + view + ".");
  }

  if (strategy === "controlled_window") {
    if (controlledWindowApproved !== true) blockers.push("Controlled migration window is not approved; set APICENTER_CONTROLLED_MIGRATION_WINDOW_APPROVED=true.");
    if (!controlledWindow.start) blockers.push("Controlled migration window start is not captured; set APICENTER_MIGRATION_WINDOW_START.");
    if (!controlledWindow.end) blockers.push("Controlled migration window end is not captured; set APICENTER_MIGRATION_WINDOW_END.");
  }

  return {
    generatedAt: now,
    repoRoot,
    strategy: strategy || undefined,
    approvals: {
      compatibilityViewsApproved,
      controlledWindowApproved,
    },
    controlledWindow,
    compatibilityViews,
    ready: blockers.length === 0,
    blockers,
    nextCommands: [
      "For one-release compatibility rollout: set APICENTER_MIGRATION_ROLLOUT_STRATEGY=compatibility_views and APICENTER_COMPATIBILITY_VIEWS_APPROVED=true.",
      "For a controlled window: set APICENTER_MIGRATION_ROLLOUT_STRATEGY=controlled_window, APICENTER_CONTROLLED_MIGRATION_WINDOW_APPROVED=true, APICENTER_MIGRATION_WINDOW_START, and APICENTER_MIGRATION_WINDOW_END.",
      "Rerun npm run db:rollout-strategy:evidence -- --out docs/operations/migration-rollout-strategy-<date>.json before approval.",
    ],
  };
}

function inspectCompatibilityViews(filePath) {
  const sql = readOptional(filePath);
  if (!sql) {
    return {
      migrationPath: filePath,
      present: false,
      expectedCount: COMPATIBILITY_VIEW_NAMES.length,
      found: [],
      missing: [...COMPATIBILITY_VIEW_NAMES],
      missingSecurityInvoker: [...COMPATIBILITY_VIEW_NAMES],
    };
  }
  const found = [];
  const missing = [];
  const missingSecurityInvoker = [];
  for (const view of COMPATIBILITY_VIEW_NAMES) {
    const escaped = escapeRegExp(view).replace(/\./g, "\\s*\\.\\s*");
    const viewPattern = new RegExp("create\\s+or\\s+replace\\s+view\\s+" + escaped + "\\b", "i");
    const securityPattern = new RegExp("create\\s+or\\s+replace\\s+view\\s+" + escaped + "\\s+with\\s*\\(\\s*security_invoker\\s*=\\s*true\\s*\\)", "i");
    if (viewPattern.test(sql)) found.push(view);
    else missing.push(view);
    if (!securityPattern.test(sql)) missingSecurityInvoker.push(view);
  }
  return {
    migrationPath: filePath,
    present: true,
    expectedCount: COMPATIBILITY_VIEW_NAMES.length,
    found,
    missing,
    missingSecurityInvoker,
  };
}

function readBoolean(value) {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  if (["true", "1", "yes", "y", "approved"].includes(normalized)) return true;
  if (["false", "0", "no", "n", "denied"].includes(normalized)) return false;
  return undefined;
}

function normalize(value) {
  return typeof value === "string" && value.trim() ? value.trim().toLowerCase() : undefined;
}

function escapeRegExp(value) {
  return String(value).replace(/[-/\^$*+?.()|[]{}]/g, "\\$&");
}

function readOptional(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch (error) {
    if (error && error.code === "ENOENT") return undefined;
    throw error;
  }
}

function writeRolloutStrategyEvidence(evidence, outPath) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(evidence, null, 2) + "\n", "utf8");
}

function readArg(name, argv = process.argv) {
  const index = argv.indexOf(name);
  if (index >= 0) return argv[index + 1];
  const inline = argv.find((arg) => arg.startsWith(name + "="));
  return inline ? inline.slice(name.length + 1) : undefined;
}

function main() {
  const evidence = collectRolloutStrategyEvidence();
  const outPath = readArg("--out");
  if (outPath) writeRolloutStrategyEvidence(evidence, path.resolve(outPath));
  console.log(JSON.stringify(evidence, null, 2));
  if (evidence.blockers.length > 0 && process.argv.includes("--fail-on-blockers")) process.exitCode = 1;
}

module.exports = {
  COMPATIBILITY_VIEW_NAMES,
  collectRolloutStrategyEvidence,
  inspectCompatibilityViews,
  writeRolloutStrategyEvidence,
};

if (require.main === module) main();
