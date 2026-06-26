#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");
const { spawnSync } = require("node:child_process");

const CONTROL_PLANE_SCHEMAS = [
  "api_center",
  "api_center_ops",
  "api_center_audit",
  "apic_catalog",
  "apic_governance",
  "apic_runtime",
  "apic_audit",
];

const BUILT_IN_GRANTEES = new Set([
  "postgres",
  "supabase_admin",
  "service_role",
  "anon",
  "authenticated",
]);

async function collectRoleDiscoveryEvidence({
  databaseUrl = process.env.DATABASE_URL,
  now = new Date().toISOString(),
  clientFactory = (connectionString) => new Client({ connectionString }),
  runner = runCommand,
  repoRoot = path.resolve(__dirname, ".."),
} = {}) {
  const evidence = {
    generatedAt: now,
    databaseUrl: {
      present: Boolean(databaseUrl),
      redactedValue: databaseUrl ? "<present>" : undefined,
    },
    schemas: CONTROL_PLANE_SCHEMAS,
    roles: [],
    recommendedAppRoles: [],
    reviewRequired: [],
    connectionRole: databaseUrl ? redactedConnectionRole(databaseUrl) : undefined,
    blockers: [],
  };

  if (!databaseUrl) {
    const linkedRun = queryLinkedRoleGrants({ repoRoot, runner });
    evidence.linkedQueryRun = serializeCommand(linkedRun);
    if (linkedRun.status !== 0) {
      evidence.blockers.push("DATABASE_URL is not set and supabase db query --linked did not complete successfully.");
      return evidence;
    }
    const rows = parseLinkedQueryRows(linkedRun.stdout);
    applyRoleRows(evidence, rows);
    return evidence;
  }

  const client = clientFactory(databaseUrl);
  await client.connect();
  try {
    const result = await client.query(
      "select table_schema, grantee, privilege_type from information_schema.role_table_grants where table_schema = any($1::text[]) order by grantee, table_schema, privilege_type",
      [CONTROL_PLANE_SCHEMAS],
    );
    const currentUser = await client.query("select current_user as current_user, session_user as session_user");
    evidence.connectionRole = {
      ...(evidence.connectionRole || {}),
      currentUser: currentUser.rows[0]?.current_user,
      sessionUser: currentUser.rows[0]?.session_user,
    };
    applyRoleRows(evidence, result.rows);
    return evidence;
  } finally {
    await client.end();
  }
}

function applyRoleRows(evidence, rows) {
  evidence.roles = aggregateRoles(rows);
  evidence.recommendedAppRoles = evidence.roles
    .filter((role) => hasWritePrivileges(role) && !isReadOnlyRoleName(role.grantee))
    .map((role) => role.grantee)
    .sort();
  evidence.reviewRequired = buildReviewNotes(evidence.roles);
  if (evidence.connectionRole && isBuiltInRuntimeRole(evidence.connectionRole.currentUser || evidence.connectionRole.urlUser)) {
    evidence.blockers.push(
      "DATABASE_URL connects as built-in privileged role " +
        (evidence.connectionRole.currentUser || evidence.connectionRole.urlUser) +
        "; configure a least-privilege runtime role such as api_center_app before approval.",
    );
  }
  if (evidence.recommendedAppRoles.length === 0) {
    evidence.blockers.push("No non-built-in app role with write grants was discovered.");
  }
}

function redactedConnectionRole(databaseUrl) {
  try {
    const parsed = new URL(databaseUrl);
    return {
      urlUser: parsed.username ? parsed.username.replace(/\..*$/, "") : undefined,
      database: parsed.pathname && parsed.pathname !== "/" ? parsed.pathname.slice(1) : undefined,
    };
  } catch {
    return { parseError: true };
  }
}

function isBuiltInRuntimeRole(role) {
  return BUILT_IN_GRANTEES.has(String(role || "").replace(/\..*$/, ""));
}

function roleGrantSql() {
  const schemas = CONTROL_PLANE_SCHEMAS.map((schema) => "'" + schema.replace(/'/g, "''") + "'").join(", ");
  return "select table_schema, grantee, privilege_type from information_schema.role_table_grants where table_schema in (" + schemas + ") order by grantee, table_schema, privilege_type";
}

function queryLinkedRoleGrants({ repoRoot, runner }) {
  return runner("supabase", ["db", "query", "--linked", "-o", "json", roleGrantSql()], { cwd: repoRoot, env: process.env });
}

function parseLinkedQueryRows(stdout) {
  const parsed = JSON.parse(stdout);
  return Array.isArray(parsed.rows) ? parsed.rows : [];
}

function runCommand(command, args, { cwd, env }) {
  const result = spawnSync(command, args, {
    cwd,
    env,
    encoding: "utf8",
    timeout: 30000,
    windowsHide: true,
  });
  return {
    command: [command, ...args].join(" "),
    status: typeof result.status === "number" ? result.status : 1,
    signal: result.signal || undefined,
    error: result.error ? result.error.message : undefined,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
  };
}

function serializeCommand(result) {
  return {
    command: result.command,
    status: result.status,
    signal: result.signal,
    error: sanitize(result.error || "") || undefined,
    stdout: truncate(sanitize(result.stdout || "")),
    stderr: truncate(sanitize(result.stderr || "")),
  };
}

function sanitize(value) {
  return String(value || "")
    .replace(/postgres(?:ql)?:\/\/\S+/gi, "<redacted-postgres-url>")
    .replace(/sbp_[A-Za-z0-9_-]+/g, "<redacted-supabase-token>")
    .replace(/(password\s*[=:]\s*)\S+/gi, "$1<redacted>");
}

function truncate(value) {
  return value.length > 8000 ? value.slice(0, 8000) + "\n<truncated>" : value;
}

function aggregateRoles(rows) {
  const roles = new Map();
  for (const row of rows) {
    const grantee = String(row.grantee);
    if (BUILT_IN_GRANTEES.has(grantee)) continue;
    const schema = String(row.table_schema);
    const privilege = String(row.privilege_type).toUpperCase();
    const role = roles.get(grantee) ?? { grantee, schemas: [] };
    let schemaEntry = role.schemas.find((entry) => entry.schema === schema);
    if (!schemaEntry) {
      schemaEntry = { schema, privileges: [] };
      role.schemas.push(schemaEntry);
    }
    if (!schemaEntry.privileges.includes(privilege)) schemaEntry.privileges.push(privilege);
    roles.set(grantee, role);
  }

  return [...roles.values()]

    .map((role) => ({
      grantee: role.grantee,
      schemas: role.schemas

        .sort((a, b) => a.schema.localeCompare(b.schema))
        .map((schema) => ({
          schema: schema.schema,
          privileges: schema.privileges.sort(),
        })),
    }))
    .sort((a, b) => a.grantee.localeCompare(b.grantee));
}

function hasWritePrivileges(role) {
  return role.schemas.some((schema) =>
    schema.privileges.some((privilege) => ["INSERT", "UPDATE", "DELETE"].includes(privilege)),
  );
}

function isReadOnlyRoleName(grantee) {
  return /reader|read[_-]?only|analyst|report/i.test(grantee);
}

function buildReviewNotes(roles) {
  const notes = [];
  for (const role of roles) {
    const privileges = new Set(role.schemas.flatMap((schema) => schema.privileges));
    const hasOnlySelect = privileges.size === 1 && privileges.has("SELECT");
    if (hasOnlySelect) {
      notes.push(role.grantee + " has SELECT-only grants and should be reviewed as reporting/read-only, not app runtime.");
    }
    if (privileges.has("DELETE")) {
      notes.push(role.grantee + " has DELETE grants; confirm this is not the API Center runtime app role.");
    }
  }
  return notes.sort();
}

function writeRoleDiscoveryEvidence(evidence, outPath) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(evidence, null, 2) + "\n", "utf8");
}

function readArg(name, argv = process.argv) {
  const index = argv.indexOf(name);
  if (index >= 0) return argv[index + 1];
  const inline = argv.find((arg) => arg.startsWith(name + "="));
  return inline ? inline.slice(name.length + 1) : undefined;
}

async function main() {
  const evidence = await collectRoleDiscoveryEvidence();
  const outPath = readArg("--out");
  if (outPath) writeRoleDiscoveryEvidence(evidence, path.resolve(outPath));
  console.log(JSON.stringify(evidence, null, 2));
  if (evidence.blockers.length > 0 && process.argv.includes("--fail-on-blockers")) process.exitCode = 1;
}

module.exports = {
  collectRoleDiscoveryEvidence,
  writeRoleDiscoveryEvidence,
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
