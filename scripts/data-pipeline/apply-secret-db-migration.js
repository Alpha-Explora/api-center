const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { Client } = require("pg");

function readArg(name, fallback) {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  if (match) return match.slice(prefix.length);
  return fallback;
}

function requireArg(name, fallback) {
  const value = readArg(name, fallback);
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function runGcloudToFile(secretName, projectId, outputPath) {
  const gcloudPath =
    process.env.GCLOUD_BIN ??
    "C:\\Users\\anton\\AppData\\Local\\Google\\Cloud SDK\\google-cloud-sdk\\bin\\gcloud.cmd";

  if (process.platform === "win32") {
    const command = `& '${escapePowerShell(gcloudPath)}' secrets versions access latest --secret='${escapePowerShell(
      secretName,
    )}' --project='${escapePowerShell(projectId)}' --out-file='${escapePowerShell(
      outputPath,
    )}'`;
    execFileSync("powershell.exe", ["-NoProfile", "-Command", command], {
      stdio: "ignore",
    });
    return;
  }

  execFileSync(
    gcloudPath,
    [
      "secrets",
      "versions",
      "access",
      "latest",
      `--secret=${secretName}`,
      `--project=${projectId}`,
      `--out-file=${outputPath}`,
    ],
    { stdio: "ignore" },
  );
}

function escapePowerShell(value) {
  return value.replace(/'/g, "''");
}

async function main() {
  const secretName = requireArg("secret", process.env.API_CENTER_GCP_SECRET);
  const projectId = requireArg("project", process.env.GOOGLE_CLOUD_PROJECT);
  const sqlFile = requireArg("sql", undefined);
  const databaseKey = readArg("database-key", "DATABASE_URL");
  const tempFile = path.join(os.tmpdir(), `${secretName}-migration-secret.json`);

  try {
    runGcloudToFile(secretName, projectId, tempFile);
    const payload = fs.readFileSync(tempFile, "utf8").replace(/^\uFEFF/, "");
    const config = JSON.parse(payload);
    const connectionString = config[databaseKey];
    if (!connectionString) {
      throw new Error(`${databaseKey} is missing from ${secretName}`);
    }

    const sql = fs.readFileSync(sqlFile, "utf8");
    const client = new Client({
      connectionString,
      ssl: { rejectUnauthorized: false },
    });
    await client.connect();
    await client.query(sql);
    await client.end();

    console.log(
      JSON.stringify({
        ok: true,
        secret: secretName,
        project: projectId,
        sql: sqlFile,
      }),
    );
  } finally {
    fs.rmSync(tempFile, { force: true });
  }
}

main().catch((error) => {
  console.error(
    JSON.stringify({
      ok: false,
      error: error.message,
    }),
  );
  process.exit(1);
});
