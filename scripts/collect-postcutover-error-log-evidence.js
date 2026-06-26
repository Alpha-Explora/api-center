#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_SNIPPETS = 20;
const POSTCUTOVER_ERROR_PATTERNS = [
  {
    id: "audit_dual_write_failure",
    pattern: /\baudit\b.*\b(?:dual[-\s]?write|postgres|persist|insert|write)\b.*\b(?:fail|failed|failure|error)\b|\b(?:fail|failed|failure|error)\b.*\baudit\b.*\b(?:dual[-\s]?write|postgres|persist|insert|write)\b|AuditEventsService.*\b(?:fail|failed|failure|error)\b/i,
  },
  {
    id: "prisma_query_error",
    pattern: /\bPrismaClient(?:KnownRequest|UnknownRequest|RustPanic|Initialization|Validation)?Error\b|\bP20\d{2}\b|Invalid\s+`prisma\.[^`]+`\s+invocation|\bprisma\b.*\b(?:query|request|transaction)\b.*\b(?:fail|failed|failure|error)\b/i,
  },
  {
    id: "postgres_connection_or_query_error",
    pattern: /\b(?:ECONNREFUSED|ETIMEDOUT|ECONNRESET|08000|08003|08006|53300|57P01|XX000)\b.*\b(?:postgres|database|db|pool|query)\b|\b(?:postgres|database|db|pool|query)\b.*\b(?:ECONNREFUSED|ETIMEDOUT|ECONNRESET|08000|08003|08006|53300|57P01|XX000)\b/i,
  },
];

function collectPostcutoverErrorLogEvidence({
  repoRoot = path.resolve(__dirname, ".."),
  env = process.env,
  now = new Date().toISOString(),
  logFile = firstPresent(env, ["API_CENTER_LOG_FILE", "APICENTER_LOG_FILE", "POSTCUTOVER_LOG_FILE"]),
  logDir = firstPresent(env, ["API_CENTER_LOG_DIR", "APICENTER_LOG_DIR", "POSTCUTOVER_LOG_DIR"]),
  maxBytes = DEFAULT_MAX_BYTES,
  maxSnippets = DEFAULT_MAX_SNIPPETS,
} = {}) {
  const sources = discoverSources({ repoRoot, logFile, logDir });
  const blockers = [];
  if (sources.length === 0) {
    blockers.push("No API Center post-cutover log source was provided; set API_CENTER_LOG_FILE or API_CENTER_LOG_DIR.");
  }

  const scans = sources.map((source) => scanSource(source, { maxBytes, maxSnippets }));
  for (const scan of scans) {
    if (!scan.present) blockers.push("Log source is missing: " + scan.source + ".");
    else if (scan.error) blockers.push("Log source could not be scanned: " + scan.source + ".");
    else if (scan.matchCount > 0) blockers.push("Post-cutover error patterns found in " + scan.source + ": " + scan.matchCount + ".");
  }

  return {
    generatedAt: now,
    repoRoot,
    environment: {
      API_CENTER_LOG_FILE: redactedEnvStatus(env, "API_CENTER_LOG_FILE"),
      APICENTER_LOG_FILE: redactedEnvStatus(env, "APICENTER_LOG_FILE"),
      POSTCUTOVER_LOG_FILE: redactedEnvStatus(env, "POSTCUTOVER_LOG_FILE"),
      API_CENTER_LOG_DIR: redactedEnvStatus(env, "API_CENTER_LOG_DIR"),
      APICENTER_LOG_DIR: redactedEnvStatus(env, "APICENTER_LOG_DIR"),
      POSTCUTOVER_LOG_DIR: redactedEnvStatus(env, "POSTCUTOVER_LOG_DIR"),
    },
    patterns: POSTCUTOVER_ERROR_PATTERNS.map((entry) => entry.id),
    sources: scans,
    ready: blockers.length === 0,
    blockers,
    nextCommands: [
      "Export API_CENTER_LOG_FILE=<post-cutover-api-center-log-file> or API_CENTER_LOG_DIR=<post-cutover-log-directory>.",
      "Run npm run db:postcutover-errors:evidence -- --out docs/operations/postcutover-error-log-scan-<date>.json after audit writes and registry reads have run.",
      "Keep the post-cutover error checklist unchecked until this artifact is ready=true against live post-cutover logs.",
    ],
  };
}

function discoverSources({ repoRoot, logFile, logDir }) {
  const sources = [];
  if (logFile) sources.push(resolveSource(repoRoot, logFile));
  if (logDir) {
    const dir = resolveSource(repoRoot, logDir);
    for (const file of listLogFiles(dir)) sources.push(file);
  }
  return [...new Set(sources)];
}

function scanSource(source, { maxBytes, maxSnippets }) {
  const result = {
    source,
    present: false,
    bytesScanned: 0,
    truncated: false,
    matchCount: 0,
    matches: [],
  };
  try {
    const stat = fs.statSync(source);
    if (!stat.isFile()) {
      result.error = "not_file";
      return result;
    }
    result.present = true;
    const start = Math.max(0, stat.size - maxBytes);
    result.truncated = start > 0;
    result.bytesScanned = stat.size - start;
    const fd = fs.openSync(source, "r");
    try {
      const buffer = Buffer.alloc(result.bytesScanned);
      fs.readSync(fd, buffer, 0, result.bytesScanned, start);
      const text = buffer.toString("utf8");
      const lines = text.split(/\r?\n/);
      lines.forEach((line, index) => {
        const matched = POSTCUTOVER_ERROR_PATTERNS.find((entry) => entry.pattern.test(line));
        if (!matched) return;
        result.matchCount += 1;
        if (result.matches.length < maxSnippets) {
          result.matches.push({
            pattern: matched.id,
            line: result.truncated ? undefined : index + 1,
            snippet: sanitize(line).slice(0, 500),
          });
        }
      });
    } finally {
      fs.closeSync(fd);
    }
  } catch (error) {
    if (error && error.code === "ENOENT") return result;
    result.error = sanitize(String(error && error.message ? error.message : error));
  }
  return result;
}

function listLogFiles(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /\.(log|txt|json|out)$/i.test(entry.name))
      .map((entry) => path.join(dir, entry.name))
      .sort();
  } catch (error) {
    if (error && error.code === "ENOENT") return [];
    throw error;
  }
}

function resolveSource(repoRoot, value) {
  return path.resolve(repoRoot, String(value));
}

function firstPresent(env, names) {
  for (const name of names) {
    if (typeof env[name] === "string" && env[name].length > 0) return env[name];
  }
  return undefined;
}

function redactedEnvStatus(env, name) {
  const value = env[name];
  return {
    present: typeof value === "string" && value.length > 0,
    redactedValue: typeof value === "string" && value.length > 0 ? "<present>" : undefined,
  };
}

function sanitize(value) {
  return String(value || "")
    .replace(/postgres(?:ql)?:\/\/\S+/gi, "<redacted-postgres-url>")
    .replace(/redis:\/\/\S+/gi, "<redacted-redis-url>")
    .replace(/sbp_[A-Za-z0-9_-]+/g, "<redacted-supabase-token>")
    .replace(/Bearer\s+[A-Za-z0-9._~+\/-]+=*/gi, "Bearer <redacted>")
    .replace(/(password\s*[=:]\s*)\S+/gi, "$1<redacted>")
    .replace(/(secret\s*[=:]\s*)\S+/gi, "$1<redacted>");
}

function writePostcutoverErrorLogEvidence(evidence, outPath) {
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
  const evidence = collectPostcutoverErrorLogEvidence({
    logFile: readArg("--log-file") || undefined,
    logDir: readArg("--log-dir") || undefined,
  });
  const outPath = readArg("--out");
  if (outPath) writePostcutoverErrorLogEvidence(evidence, path.resolve(outPath));
  console.log(JSON.stringify(evidence, null, 2));
  if (evidence.blockers.length > 0 && process.argv.includes("--fail-on-blockers")) process.exitCode = 1;
}

module.exports = {
  POSTCUTOVER_ERROR_PATTERNS,
  collectPostcutoverErrorLogEvidence,
  scanSource,
  sanitize,
  writePostcutoverErrorLogEvidence,
};

if (require.main === module) main();
