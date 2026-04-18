#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');

const FORBIDDEN_DIRECTORIES = ['src/sdk', 'examples/sandbox/sdk'];
const FORBIDDEN_IMPORT_PATTERNS = [
  {
    description: 'Local SDK source import is forbidden; consume @apicenter/sdk package instead',
    regex: /(from|require\()\s*['"](?:\.{1,2}\/)+sdk(?:\/|['"])/,
  },
  {
    description: 'Direct import from api-shared-services source is forbidden in gateway',
    regex: /(from|require\()\s*['"][^'"]*api-shared-services\/src\//,
  },
  {
    description: 'file: SDK dependency is forbidden; use published @apicenter/sdk version',
    regex: /"@apicenter\/sdk"\s*:\s*"file:/,
  },
];

const SDK_RUNTIME_LEAK_PATTERNS = [
  {
    description: 'SDK code must not import runtime auth internals',
    regex: /from\s+['"][^'"]*src\/auth\//,
  },
  {
    description: 'SDK code must not import runtime registry internals',
    regex: /from\s+['"][^'"]*src\/registry\//,
  },
  {
    description: 'SDK code must not import runtime proxy internals',
    regex: /from\s+['"][^'"]*src\/shared\/proxy-handler/,
  },
  {
    description: 'SDK code must not import runtime config internals',
    regex: /from\s+['"][^'"]*src\/config\//,
  },
];

const TEXT_FILE_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.mjs',
  '.cjs',
  '.json',
  '.md',
  '.yml',
  '.yaml',
]);

const IGNORE_DIRECTORIES = new Set(['.git', 'node_modules', 'dist', 'coverage']);
const SHARED_MANIFEST_FORBIDDEN_PREFIXES = ['examples/', 'docs/'];

function toPosixPath(filePath) {
  return filePath.split(path.sep).join('/');
}

function collectFiles(startDir, results = []) {
  const entries = fs.readdirSync(startDir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(startDir, entry.name);
    const relPath = toPosixPath(path.relative(repoRoot, fullPath));

    if (entry.isDirectory()) {
      if (IGNORE_DIRECTORIES.has(entry.name)) {
        continue;
      }
      collectFiles(fullPath, results);
      continue;
    }

    if (TEXT_FILE_EXTENSIONS.has(path.extname(entry.name))) {
      results.push(relPath);
    }
  }

  return results;
}

function isLikelySdkCodePath(relPath) {
  return /(^|\/)sdk(\/|$)/.test(relPath) || /(^|\/)api-shared-services(\/|$)/.test(relPath);
}

function collectDirectoryViolations() {
  const violations = [];

  for (const forbiddenDir of FORBIDDEN_DIRECTORIES) {
    const absolutePath = path.join(repoRoot, forbiddenDir);
    if (fs.existsSync(absolutePath)) {
      violations.push({
        file: toPosixPath(forbiddenDir),
        reason: 'Forbidden local SDK source directory exists in gateway repository',
      });
    }
  }

  return violations;
}

function collectPatternViolations(files) {
  const violations = [];

  for (const relPath of files) {
    const absolutePath = path.join(repoRoot, relPath);
    const content = fs.readFileSync(absolutePath, 'utf8');

    for (const pattern of FORBIDDEN_IMPORT_PATTERNS) {
      if (pattern.regex.test(content)) {
        violations.push({
          file: relPath,
          reason: pattern.description,
        });
      }
    }

    if (!isLikelySdkCodePath(relPath)) {
      continue;
    }

    for (const pattern of SDK_RUNTIME_LEAK_PATTERNS) {
      if (pattern.regex.test(content)) {
        violations.push({
          file: relPath,
          reason: pattern.description,
        });
      }
    }
  }

  return violations;
}

function isJsonFile(relPath) {
  return path.extname(relPath).toLowerCase() === '.json';
}

function shouldInspectForSharedManifest(relPath) {
  return SHARED_MANIFEST_FORBIDDEN_PREFIXES.some((prefix) => relPath.startsWith(prefix));
}

function collectSharedManifestViolations(files) {
  const violations = [];

  for (const relPath of files) {
    if (!isJsonFile(relPath) || !shouldInspectForSharedManifest(relPath)) {
      continue;
    }

    const absolutePath = path.join(repoRoot, relPath);
    const content = fs.readFileSync(absolutePath, 'utf8');

    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch {
      continue;
    }

    if (parsed?.serviceType === 'shared') {
      violations.push({
        file: relPath,
        reason:
          'Shared-service manifests must live in the api-shared-services repository, not in api-center',
      });
    }
  }

  return violations;
}

function printViolationsAndExit(violations) {
  if (violations.length === 0) {
    console.log('Boundary check passed.');
    return;
  }

  console.error('\nBoundary check failed:\n');
  for (const violation of violations) {
    console.error(` - ${violation.file}: ${violation.reason}`);
  }
  process.exit(1);
}

function main() {
  const violations = collectDirectoryViolations();

  const files = collectFiles(repoRoot);
  violations.push(...collectPatternViolations(files));
  violations.push(...collectSharedManifestViolations(files));

  printViolationsAndExit(violations);
}

main();
