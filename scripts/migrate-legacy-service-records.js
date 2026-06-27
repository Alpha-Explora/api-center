#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");
require("dotenv").config({ path: path.resolve(__dirname, "../.env"), quiet: true });

const DEFAULT_INVENTORY = "docs/operations/legacy-service-migration-2026-06-28.json";
const DEFAULT_OUT = "docs/operations/legacy-service-record-migration-2026-06-28.json";
const MIGRATE_TAG = "apic:environment-migrated";
const TEST_ONLY_TAG = "apic:test-only";
const RETIRED_TAG = "apic:legacy-retired";
const ACTOR_ID = "codex-task-13";

async function main() {
  const argv = process.argv.slice(2);
  const repoRoot = path.resolve(__dirname, "..");
  const inventoryPath = path.resolve(
    repoRoot,
    readArg(argv, "--inventory") || DEFAULT_INVENTORY,
  );
  const outPath = path.resolve(repoRoot, readArg(argv, "--out") || DEFAULT_OUT);
  const apply = argv.includes("--apply");
  const sunsetDays = Number.parseInt(readArg(argv, "--sunset-days") || "30", 10);
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required.");

  const inventory = JSON.parse(fs.readFileSync(inventoryPath, "utf8"));
  const now = new Date();
  const sunsetAt = new Date(now.getTime() + safeSunsetDays(sunsetDays) * 86400_000);
  const plan = buildMigrationPlan(inventory, now, sunsetAt);

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const current = await loadCurrentServices(client);
    const actions = resolveActions(plan, current);
    const evidence = {
      generatedAt: now.toISOString(),
      mode: apply ? "apply" : "dry-run",
      payloadPolicy:
        "No service secret values are read or recorded. This artifact records catalog row IDs, service IDs, action types, and environment row metadata only.",
      registrySourceAssumption:
        "Live API Center uses REGISTRY_SOURCE=postgres; redeploy/restart is required for running API instances to reload changed registry memory.",
      inventoryPath: path.relative(repoRoot, inventoryPath).replace(/\\/g, "/"),
      actionSummary: summarizeActions(actions),
      actions,
      applied: false,
      verification: {
        nextCommands: [
          "node scripts/inventory-legacy-service-migration.js --out docs/operations/legacy-service-migration-2026-06-28.json",
          "npm run registry:verify -- --out docs/operations/registry-parity-post-service-migration-2026-06-28.json",
          "Redeploy/restart live API Center so REGISTRY_SOURCE=postgres reloads the migrated catalog state.",
        ],
      },
    };

    if (apply) {
      await applyActions(client, actions, now);
      evidence.applied = true;
    }

    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(evidence, null, 2) + "\n", "utf8");
    console.log(
      JSON.stringify({
        out: path.relative(repoRoot, outPath).replace(/\\/g, "/"),
        mode: evidence.mode,
        applied: evidence.applied,
        actionSummary: evidence.actionSummary,
      }),
    );
  } finally {
    await client.end();
  }
}

function buildMigrationPlan(inventory, now, sunsetAt) {
  const services = inventory.catalog?.activeServices || [];
  return services
    .filter((service) => service.legacySignals?.length > 0)
    .map((service) => {
      if (service.migrationDisposition === "migrate_to_environment_rows") {
        return {
          serviceId: service.serviceId,
          action: "migrate_to_environment_rows",
          reason: "Active external service keeps current backend URL but must stop relying on implicit legacy environment fallback.",
          targetEnvironments: [
            buildEnvironmentTarget(service, "test"),
            buildEnvironmentTarget(service, "live"),
          ],
        };
      }

      if (service.serviceId === "smoke-tribe") {
        return {
          serviceId: service.serviceId,
          action: "mark_test_only",
          reason: "Internal smoke service remains available only as explicit test control-plane data.",
          sunsetAt: sunsetAt.toISOString(),
          targetEnvironments: [buildEnvironmentTarget(service, "test")],
        };
      }

      return {
        serviceId: service.serviceId,
        action: "retire_legacy_record",
        reason:
          "Temporary, placeholder, or invalid legacy service record should no longer appear as active registry data.",
        retiredAt: now.toISOString(),
      };
    });
}

function buildEnvironmentTarget(service, environment) {
  return {
    environment,
    baseUrl: service.baseUrl,
    healthCheck: service.healthCheck || null,
    status: "active",
  };
}

async function loadCurrentServices(client) {
  const result = await client.query(`
    select
      s.id,
      s.service_id,
      s.name,
      s.status,
      s.base_url,
      s.health_check_path,
      s.version,
      s.tags,
      s.sunset_date,
      s.updated_at,
      coalesce(jsonb_agg(jsonb_build_object(
        'environment', e.environment,
        'baseUrl', e.base_url,
        'healthCheck', e.health_check_path,
        'status', e.status
      ) order by e.environment) filter (where e.id is not null), '[]'::jsonb) as environments
    from apic_catalog.services s
    left join apic_catalog.service_environments e on e.service_id = s.id
    group by s.id
    order by s.service_id
  `);
  return Object.fromEntries(
    result.rows.map((row) => [
      row.service_id,
      {
        id: row.id,
        serviceId: row.service_id,
        name: row.name,
        status: row.status,
        baseUrl: row.base_url,
        healthCheck: row.health_check_path,
        version: row.version,
        tags: normalizeTags(row.tags),
        sunsetDate: row.sunset_date ? new Date(row.sunset_date).toISOString() : null,
        updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
        environments: row.environments || [],
      },
    ]),
  );
}

function resolveActions(plan, current) {
  return plan.map((item) => {
    const before = current[item.serviceId];
    if (!before) {
      return {
        ...item,
        before: null,
        skipped: true,
        skipReason: "service_not_found",
      };
    }
    return {
      ...item,
      before: summarizeService(before),
      after: previewAfter(item, before),
    };
  });
}

function previewAfter(action, before) {
  if (action.action === "retire_legacy_record") {
    return {
      ...summarizeService(before),
      status: "retired",
      tags: addTags(before.tags, [MIGRATE_TAG, RETIRED_TAG]),
    };
  }
  if (action.action === "mark_test_only") {
    return {
      ...summarizeService(before),
      tags: addTags(before.tags, [MIGRATE_TAG, TEST_ONLY_TAG]),
      sunsetDate: action.sunsetAt,
      environments: upsertPreviewEnvironments(
        before.environments,
        action.targetEnvironments,
      ),
    };
  }
  return {
    ...summarizeService(before),
    tags: addTags(before.tags, [MIGRATE_TAG]),
    environments: upsertPreviewEnvironments(
      before.environments,
      action.targetEnvironments,
    ),
  };
}

async function applyActions(client, actions, now) {
  await client.query("begin");
  try {
    for (const action of actions) {
      if (action.skipped) continue;
      if (action.action === "retire_legacy_record") {
        await retireService(client, action, now);
      } else if (action.action === "mark_test_only") {
        await markTestOnlyService(client, action, now);
      } else if (action.action === "migrate_to_environment_rows") {
        await migrateEnvironmentRows(client, action, now);
      }
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}

async function migrateEnvironmentRows(client, action, now) {
  const serviceId = action.before.id;
  await updateServiceTags(client, serviceId, [MIGRATE_TAG], now);
  for (const environment of action.targetEnvironments) {
    await upsertEnvironment(client, serviceId, environment, now);
  }
  await recordLifecycleEvent(client, {
    serviceId,
    eventType: "updated",
    previousStatus: action.before.status,
    nextStatus: action.before.status,
    nextVersion: action.before.version,
    metadata: {
      task: "task-13-service-record-migration",
      action: action.action,
      reason: action.reason,
      environments: action.targetEnvironments.map((target) => target.environment),
    },
  });
}

async function markTestOnlyService(client, action, now) {
  const serviceId = action.before.id;
  await updateServiceTags(client, serviceId, [MIGRATE_TAG, TEST_ONLY_TAG], now, {
    sunsetAt: action.sunsetAt,
  });
  for (const environment of action.targetEnvironments) {
    await upsertEnvironment(client, serviceId, environment, now);
  }
  await recordLifecycleEvent(client, {
    serviceId,
    eventType: "updated",
    previousStatus: action.before.status,
    nextStatus: action.before.status,
    nextVersion: action.before.version,
    metadata: {
      task: "task-13-service-record-migration",
      action: action.action,
      reason: action.reason,
      sunsetAt: action.sunsetAt,
    },
  });
}

async function retireService(client, action, now) {
  const serviceId = action.before.id;
  await client.query(
    `
      update apic_catalog.services
      set status = 'retired',
          tags = $2::jsonb,
          sunset_date = coalesce(sunset_date, $3::timestamptz),
          updated_at = $3::timestamptz
      where id = $1::uuid
    `,
    [
      serviceId,
      JSON.stringify(addTags(action.before.tags, [MIGRATE_TAG, RETIRED_TAG])),
      now.toISOString(),
    ],
  );
  await client.query(
    `
      update apic_catalog.service_environments
      set status = 'retired',
          updated_at = $2::timestamptz
      where service_id = $1::uuid
    `,
    [serviceId, now.toISOString()],
  );
  await recordLifecycleEvent(client, {
    serviceId,
    eventType: "retired",
    previousStatus: action.before.status,
    nextStatus: "retired",
    nextVersion: action.before.version,
    metadata: {
      task: "task-13-service-record-migration",
      action: action.action,
      reason: action.reason,
    },
  });
}

async function updateServiceTags(client, serviceId, tags, now, options = {}) {
  const assignments = [
    "tags = (select jsonb_agg(distinct value) from jsonb_array_elements_text(tags || $2::jsonb) as value)",
    "updated_at = $3::timestamptz",
  ];
  const params = [serviceId, JSON.stringify(tags), now.toISOString()];
  if (options.sunsetAt) {
    assignments.push("sunset_date = coalesce(sunset_date, $4::timestamptz)");
    params.push(options.sunsetAt);
  }
  await client.query(
    `
      update apic_catalog.services
      set ${assignments.join(", ")}
      where id = $1::uuid
    `,
    params,
  );
}

async function upsertEnvironment(client, serviceId, environment, now) {
  await client.query(
    `
      insert into apic_catalog.service_environments (
        service_id,
        environment,
        base_url,
        health_check_path,
        status,
        registered_at,
        updated_at
      )
      values ($1::uuid, $2, $3, $4, $5, $6::timestamptz, $6::timestamptz)
      on conflict on constraint service_environment_unique do update
      set base_url = excluded.base_url,
          health_check_path = excluded.health_check_path,
          status = excluded.status,
          updated_at = excluded.updated_at
    `,
    [
      serviceId,
      environment.environment,
      environment.baseUrl,
      environment.healthCheck,
      environment.status,
      now.toISOString(),
    ],
  );
}

async function recordLifecycleEvent(client, input) {
  await client.query(
    `
      insert into apic_catalog.service_lifecycle_events (
        service_id,
        event_type,
        previous_status,
        next_status,
        next_version,
        actor_type,
        actor_id,
        metadata
      )
      values ($1::uuid, $2, $3, $4, $5, 'operator', $6, $7::jsonb)
    `,
    [
      input.serviceId,
      input.eventType,
      input.previousStatus,
      input.nextStatus,
      input.nextVersion,
      ACTOR_ID,
      JSON.stringify(input.metadata),
    ],
  );
}

function summarizeService(service) {
  return {
    id: service.id,
    serviceId: service.serviceId,
    status: service.status,
    baseUrl: service.baseUrl,
    healthCheck: service.healthCheck || null,
    version: service.version || null,
    tags: service.tags,
    sunsetDate: service.sunsetDate,
    environments: service.environments,
  };
}

function upsertPreviewEnvironments(existing, targets) {
  const byEnv = new Map((existing || []).map((item) => [item.environment, item]));
  for (const target of targets) byEnv.set(target.environment, target);
  return [...byEnv.values()].sort((a, b) =>
    String(a.environment).localeCompare(String(b.environment)),
  );
}

function summarizeActions(actions) {
  return actions.reduce((acc, action) => {
    const key = action.skipped ? "skipped" : action.action;
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function normalizeTags(tags) {
  return Array.isArray(tags) ? tags.map(String).sort() : [];
}

function addTags(existing, next) {
  return [...new Set([...normalizeTags(existing), ...next])].sort();
}

function safeSunsetDays(value) {
  return Number.isFinite(value) && value > 0 ? value : 30;
}

function readArg(argv, name) {
  const index = argv.indexOf(name);
  if (index >= 0) return argv[index + 1];
  const inline = argv.find((arg) => arg.startsWith(`${name}=`));
  return inline ? inline.slice(name.length + 1) : undefined;
}

module.exports = {
  buildMigrationPlan,
  resolveActions,
  summarizeActions,
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
