#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_REPO_ROOT = path.resolve(__dirname, '..');

const FORBIDDEN_DIRECTORIES = ['apps/gateway/src/sdk', 'examples/sandbox/sdk'];
const FORBIDDEN_IMPORT_PATTERNS = [
  {
    description:
      'Gateway must consume the SDK package, not import its source files',
    regex: /(from|require\()\s*['"][^'"]*packages\/sdk\/src\//,
  },
  {
    description: 'Direct import from shared service runtime source is forbidden in gateway',
    regex: /(from|require\()\s*['"][^'"]*apps\/(?:payments|email|sms|otp|geo|gauth)\/src\//,
  },
  {
    description:
      'file: SDK dependency is forbidden; use the @alpha-explora/apicenter-sdk workspace or a published version',
    regex: /"@alpha-explora\/apicenter-sdk"\s*:\s*"file:/,
  },
];

const SDK_RUNTIME_LEAK_PATTERNS = [
  {
    description: 'SDK code must not import runtime auth internals',
    regex: /from\s+['"][^'"]*src\/domains\/auth-security\/auth\//,
  },
  {
    description: 'SDK code must not import runtime registry internals',
    regex: /from\s+['"][^'"]*src\/domains\/catalog-registry\/registry\//,
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

const BOUNDED_CONTEXTS = [
  {
    name: 'catalog_registry',
    paths: [
      'apps/gateway/src/registry',
      'apps/gateway/src/catalog',
      'apps/gateway/src/domains/catalog-registry',
    ],
    schemas: ['apic_catalog'],
  },
  {
    name: 'governance',
    paths: [
      'apps/gateway/src/approvals',
      'apps/gateway/src/quotas',
      'apps/gateway/src/entitlements',
      'apps/gateway/src/developer-portal',
      'apps/gateway/src/policy',
      'apps/gateway/src/domains/governance',
      'apps/gateway/src/domains/payments',
    ],
    schemas: ['apic_governance'],
  },
  {
    name: 'runtime_operations',
    paths: [
      'apps/gateway/src/analytics',
      'apps/gateway/src/health',
      'apps/gateway/src/forecasting',
      'apps/gateway/src/operations',
      'apps/gateway/src/domains/runtime-ops',
    ],
    schemas: ['apic_runtime'],
  },
  {
    name: 'audit_evidence',
    paths: [
      'apps/gateway/src/compliance',
      'apps/gateway/src/domains/compliance',
    ],
    schemas: ['apic_audit'],
  },
  {
    name: 'gateway_control_plane',
    paths: [
      'apps/gateway/src/gateway-control-plane',
      'apps/gateway/src/domains/gateway-proxy',
    ],
    schemas: ['apic_gateway'],
  },
  {
    name: 'shared_service_platform',
    paths: ['apps/gateway/src/domains/gateway-proxy/shared-services'],
    schemas: ['shared_core'],
  },
  {
    name: 'auth_identity',
    paths: [
      'apps/gateway/src/auth',
      'apps/gateway/src/secrets',
      'apps/gateway/src/domains/auth-security',
    ],
    schemas: [],
  },
  {
    name: 'payment_data_plane',
    paths: ['apps/payments'],
    schemas: ['shared_payment'],
  },
  {
    name: 'shared_kernel',
    paths: [
      'apps/gateway/src/shared',
      'apps/gateway/src/config',
      'apps/gateway/src/database',
      'apps/gateway/src/metrics',
    ],
    schemas: [],
    public: true,
  },
];

const SCHEMA_OWNERS = new Map(
  BOUNDED_CONTEXTS.flatMap((context) =>
    context.schemas.map((schema) => [schema, context.name]),
  ),
);

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
  '.prisma',
]);

const IGNORE_DIRECTORIES = new Set(['.git', 'node_modules', 'dist', 'coverage']);
const SHARED_MANIFEST_FORBIDDEN_PREFIXES = ['examples/', 'docs/'];
const IMPORT_SPECIFIER_PATTERN =
  /(?:import\s+(?:type\s+)?(?:[^'";]+?\s+from\s+)?|export\s+[^'";]+?\s+from\s+|require\()\s*['"]([^'"]+)['"]/g;
const APIC_SCHEMA_PATTERN = /\b(apic_[a-z0-9_]+|shared_core)\./g;
const RAW_SCHEMA_ACCESS_PATTERN = /\b(select\s+.*from|from|join|update|insert\s+into|delete\s+from|\$queryRaw|\$executeRaw)\b/i;
const PUBLIC_SERVICE_CONTRACT_FILES = new Set([
  'apps/gateway/src/auth/auth.service.ts',
  'apps/gateway/src/auth/guards/jwt-auth.guard.ts',
  'apps/gateway/src/auth/guards/scoped-admin.guard.ts',
  'apps/gateway/src/auth/token-store.service.ts',
  'apps/gateway/src/auth/vault.service.ts',
  'apps/gateway/src/registry/registry.service.ts',
  'apps/gateway/src/approvals/approval-request.service.ts',
  'apps/gateway/src/analytics/audit-events.service.ts',
  'apps/gateway/src/analytics/gateway-traffic.service.ts',
  'apps/gateway/src/analytics/shared-service-usage.service.ts',
  'apps/gateway/src/entitlements/tribe-plan.service.ts',
  'apps/gateway/src/forecasting/quota-forecast.service.ts',
  'apps/gateway/src/operations/emergency-control.service.ts',
  'apps/gateway/src/operations/promotion-evidence-bundle.service.ts',
  'apps/gateway/src/policy/policy-engine.service.ts',
  'apps/gateway/src/quotas/tribe-quota-enforcer.service.ts',
  'apps/gateway/src/quotas/tribe-quota-policy.service.ts',
  'apps/gateway/src/secrets/tribe-secret-rotation.service.ts',
]);

function toPosixPath(filePath) {
  return filePath.split(path.sep).join('/');
}

function normalizeRelPath(relPath) {
  return relPath.split(path.sep).join('/').replace(/^\.\//, '');
}

function collectFiles(startDir, results = []) {
  if (!fs.existsSync(startDir)) return results;
  const entries = fs.readdirSync(startDir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(startDir, entry.name);

    if (entry.isDirectory()) {
      if (IGNORE_DIRECTORIES.has(entry.name)) {
        continue;
      }
      collectFiles(fullPath, results);
      continue;
    }

    if (TEXT_FILE_EXTENSIONS.has(path.extname(entry.name))) {
      results.push(fullPath);
    }
  }

  return results;
}

function collectRepoFiles(repoRoot) {
  return collectFiles(repoRoot).map((fullPath) =>
    toPosixPath(path.relative(repoRoot, fullPath)),
  );
}

function isLikelySdkCodePath(relPath) {
  return relPath.startsWith('packages/sdk/');
}

function collectDirectoryViolations(repoRoot) {
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

function collectPatternViolations(files, repoRoot) {
  const violations = [];

  for (const relPath of files) {
    const absolutePath = path.join(repoRoot, relPath);
    const content = fs.readFileSync(absolutePath, 'utf8');

    for (const pattern of FORBIDDEN_IMPORT_PATTERNS) {
      if (pattern.description.startsWith('file:') && path.basename(relPath) !== 'package.json') continue;
      if (!pattern.description.startsWith('file:') && !relPath.startsWith('apps/gateway/src/')) continue;
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

function collectSharedManifestViolations(files, repoRoot) {
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

function findContextForFile(relPath) {
  const normalized = normalizeRelPath(relPath);
  return BOUNDED_CONTEXTS.find((context) =>
    context.paths.some((contextPath) =>
      normalized === contextPath || normalized.startsWith(`${contextPath}/`),
    ),
  );
}

function isProductionSourceFile(relPath) {
  return (
    relPath.startsWith('apps/gateway/src/') &&
    /\.(ts|tsx|js|mjs|cjs)$/.test(relPath) &&
    !/\.(spec|test)\.(ts|tsx|js|mjs|cjs)$/.test(relPath)
  );
}

function isPublicContractFile(relPath) {
  const normalized = normalizeRelPath(relPath);
  return (
    normalized.endsWith('.module.ts') ||
    normalized.endsWith('.types.ts') ||
    normalized.endsWith('.dto.ts') ||
    normalized.startsWith('apps/gateway/src/openapi/') ||
    normalized.startsWith('apps/gateway/src/contracts/') ||
    normalized.startsWith('apps/gateway/src/shared/') ||
    normalized.startsWith('apps/gateway/src/config/') ||
    normalized === 'apps/gateway/src/database/prisma.service.ts' ||
    PUBLIC_SERVICE_CONTRACT_FILES.has(normalized)
  );
}

function resolveImportTarget(importerRelPath, specifier, repoRoot) {
  let base;
  if (specifier.startsWith('.')) {
    const importerDir = path.dirname(path.join(repoRoot, importerRelPath));
    base = path.resolve(importerDir, specifier);
  } else if (specifier.startsWith('@')) {
    const tsconfigPath = path.join(repoRoot, 'apps/gateway/tsconfig.json');
    if (!fs.existsSync(tsconfigPath)) return undefined;
    const aliases = JSON.parse(fs.readFileSync(tsconfigPath, 'utf8')).compilerOptions?.paths || {};
    const match = Object.entries(aliases).find(([pattern]) => {
      const prefix = pattern.replace(/\*$/, '');
      return pattern.endsWith('*') ? specifier.startsWith(prefix) : specifier === pattern;
    });
    if (!match) return undefined;
    const [pattern, targets] = match;
    const suffix = pattern.endsWith('*') ? specifier.slice(pattern.length - 1) : '';
    base = path.resolve(repoRoot, 'apps/gateway', targets[0].replace('*', suffix));
  } else return undefined;
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.mjs`,
    `${base}.cjs`,
    path.join(base, 'index.ts'),
    path.join(base, 'index.tsx'),
    path.join(base, 'index.js'),
  ];

  const resolved = candidates.find((candidate) => fs.existsSync(candidate));
  if (!resolved) return undefined;

  const relPath = toPosixPath(path.relative(repoRoot, resolved));
  return relPath.startsWith('..') ? undefined : relPath;
}

function readImports(content) {
  const imports = [];
  IMPORT_SPECIFIER_PATTERN.lastIndex = 0;
  let match;
  while ((match = IMPORT_SPECIFIER_PATTERN.exec(content))) {
    imports.push(match[1]);
  }
  return imports;
}

function collectBoundedContextImportViolations(files, repoRoot) {
  const violations = [];
  const baselinePath = path.join(repoRoot, 'scripts/boundary-legacy-imports.json');
  const legacy = fs.existsSync(baselinePath)
    ? new Set(JSON.parse(fs.readFileSync(baselinePath, 'utf8')))
    : new Set();

  for (const relPath of files) {
    if (!isProductionSourceFile(relPath)) continue;

    const sourceContext = findContextForFile(relPath);
    if (!sourceContext) continue;

    const content = fs.readFileSync(path.join(repoRoot, relPath), 'utf8');
    for (const specifier of readImports(content)) {
      const targetRelPath = resolveImportTarget(relPath, specifier, repoRoot);
      if (!targetRelPath || !isProductionSourceFile(targetRelPath)) continue;

      const targetContext = findContextForFile(targetRelPath);
      if (!targetContext || targetContext.name === sourceContext.name) continue;
      if (targetContext.public || sourceContext.public) continue;
      if (isPublicContractFile(targetRelPath)) continue;
      if (legacy.has(`${relPath} -> ${targetRelPath}`)) continue;

      violations.push({
        file: relPath,
        reason: `Cross-context import from ${sourceContext.name} to internal ${targetContext.name} file ${targetRelPath} is forbidden; import a public module, DTO, type, read model, or event contract instead`,
      });
    }
  }

  return violations;
}

function collectSchemaAccessViolations(files, repoRoot) {
  const violations = [];

  for (const relPath of files) {
    if (!isProductionSourceFile(relPath)) continue;
    const sourceContext = findContextForFile(relPath);
    if (!sourceContext || sourceContext.public) continue;

    const content = fs.readFileSync(path.join(repoRoot, relPath), 'utf8');
    APIC_SCHEMA_PATTERN.lastIndex = 0;
    const seen = new Set();
    let match;
    while ((match = APIC_SCHEMA_PATTERN.exec(content))) {
      const schema = match[1];
      const lineStart = content.lastIndexOf('\n', match.index) + 1;
      const lineEnd = content.indexOf('\n', match.index);
      const line = content.slice(lineStart, lineEnd === -1 ? undefined : lineEnd);
      if (!RAW_SCHEMA_ACCESS_PATTERN.test(line)) continue;
      if (seen.has(schema)) continue;
      seen.add(schema);

      const owner = SCHEMA_OWNERS.get(schema);
      if (!owner) {
        violations.push({
          file: relPath,
          reason: `Schema-qualified access to ${schema} is not allowed because no bounded-context owner is defined`,
        });
        continue;
      }

      if (owner !== sourceContext.name) {
        violations.push({
          file: relPath,
          reason: `Schema-qualified access to ${schema} from ${sourceContext.name} is forbidden; owner is ${owner}`,
        });
      }
    }
  }

  return violations;
}

function collectPrismaSchemaOwnershipViolations(files, repoRoot) {
  const violations = [];

  for (const relPath of files) {
    if (path.basename(relPath) !== 'schema.prisma') continue;
    const content = fs.readFileSync(path.join(repoRoot, relPath), 'utf8');
    const schemaPattern = /@@schema\("([^"]+)"\)/g;
    let match;
    while ((match = schemaPattern.exec(content))) {
      const schema = match[1];
      if (!SCHEMA_OWNERS.has(schema)) {
        violations.push({
          file: relPath,
          reason: `No bounded-context owner is defined for schema ${schema}`,
        });
      }
    }
  }

  return violations;
}

function runBoundaryChecks(options = {}) {
  const repoRoot = path.resolve(options.repoRoot ?? DEFAULT_REPO_ROOT);
  const files = options.files?.map(normalizeRelPath) ?? collectRepoFiles(repoRoot);
  const violations = collectDirectoryViolations(repoRoot);

  violations.push(...collectPatternViolations(files, repoRoot));
  violations.push(...collectSharedManifestViolations(files, repoRoot));
  violations.push(...collectBoundedContextImportViolations(files, repoRoot));
  violations.push(...collectSchemaAccessViolations(files, repoRoot));
  violations.push(...collectPrismaSchemaOwnershipViolations(files, repoRoot));

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
  printViolationsAndExit(runBoundaryChecks());
}

if (require.main === module) {
  main();
}

module.exports = {
  BOUNDED_CONTEXTS,
  runBoundaryChecks,
};
