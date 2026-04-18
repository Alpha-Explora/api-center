// =============================================================================
// src/external/guards/external-policy.guard.ts — External API policy guard
// =============================================================================
// Enforces secure-by-default policy on /api/v1/external/:apiName/* routes.
//
// Controls:
//  1. Per-API + per-operation scopes
//  2. Per-tribe allowlists (EXTERNAL_ALLOWLIST_* env vars)
//  3. Method/path allowlist matching (default deny)
//  4. Kafka topic tenancy isolation (prevents cross-tribe topic access)
// =============================================================================

import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { AuthService } from '../../auth/auth.service';
import { LoggerService } from '../../shared/logger.service';
import { ForbiddenError } from '../../shared/errors';
import { AuthenticatedRequest } from '../../types';

type HttpMethod = 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

type ExternalPolicyRequest = AuthenticatedRequest & {
  method: string;
  path: string;
  params?: Record<string, string | undefined>;
};

interface ExternalPathRule {
  methods: readonly HttpMethod[];
  path: RegExp;
  requiredScopes: readonly string[];
  kafkaTopicScoped?: boolean;
  policyLabel: string;
}

interface ExternalApiPolicy {
  allowlistEnv: string;
  requiredScopes: readonly string[];
  rules: readonly ExternalPathRule[];
}

const SAFE_EXTERNAL_PATH_RE =
  /^\/(?:[A-Za-z0-9._~!$&'()*+,;=:@%-]+(?:\/[A-Za-z0-9._~!$&'()*+,;=:@%-]+)*)?$/;

const EXTERNAL_API_POLICIES: Record<string, ExternalApiPolicy> = {
  geolocation: {
    allowlistEnv: 'EXTERNAL_ALLOWLIST_GEOLOCATION',
    requiredScopes: ['external:geolocation:read'],
    rules: [
      {
        methods: ['POST'],
        path: /^\/geolocation\/v1\/geolocate$/,
        requiredScopes: [],
        policyLabel: 'geolocation.locate',
      },
    ],
  },
  // Reserved policy for onboarding a dedicated geotagging provider.
  geotagging: {
    allowlistEnv: 'EXTERNAL_ALLOWLIST_GEOTAGGING',
    requiredScopes: ['external:geotagging:read'],
    rules: [
      {
        methods: ['GET', 'HEAD'],
        path: /^\/v1\/geotags(?:\/[A-Za-z0-9._:-]+)?$/,
        requiredScopes: [],
        policyLabel: 'geotagging.read',
      },
      {
        methods: ['POST'],
        path: /^\/v1\/geotags\/resolve$/,
        requiredScopes: [],
        policyLabel: 'geotagging.resolve',
      },
      {
        methods: ['POST', 'PUT', 'PATCH', 'DELETE'],
        path: /^\/v1\/geotags(?:\/[A-Za-z0-9._:-]+)?$/,
        requiredScopes: ['external:geotagging:write'],
        policyLabel: 'geotagging.write',
      },
    ],
  },
  geofencing: {
    allowlistEnv: 'EXTERNAL_ALLOWLIST_GEOFENCING',
    requiredScopes: ['external:geofencing:read'],
    rules: [
      {
        methods: ['GET', 'HEAD'],
        path: /^\/v1\/geofences(?:\/[A-Za-z0-9._:-]+)?(?:\/events)?$/,
        requiredScopes: [],
        policyLabel: 'geofencing.read',
      },
      {
        methods: ['POST'],
        path: /^\/v1\/geofences\/check$/,
        requiredScopes: [],
        policyLabel: 'geofencing.check',
      },
      {
        methods: ['POST', 'PUT', 'PATCH', 'DELETE'],
        path: /^\/v1\/geofences(?:\/[A-Za-z0-9._:-]+)?(?:\/events)?$/,
        requiredScopes: ['external:geofencing:write'],
        policyLabel: 'geofencing.write',
      },
    ],
  },
  kafka: {
    allowlistEnv: 'EXTERNAL_ALLOWLIST_KAFKA',
    requiredScopes: ['external:kafka:read'],
    rules: [
      {
        methods: ['GET'],
        path: /^\/v3\/clusters$/,
        requiredScopes: [],
        policyLabel: 'kafka.cluster.list',
      },
      {
        methods: ['GET'],
        path: /^\/v3\/clusters\/[^/]+\/topics$/,
        requiredScopes: [],
        policyLabel: 'kafka.topic.list',
      },
      {
        methods: ['GET'],
        path: /^\/v3\/clusters\/[^/]+\/topics\/[^/]+$/,
        requiredScopes: [],
        kafkaTopicScoped: true,
        policyLabel: 'kafka.topic.read',
      },
      {
        methods: ['POST'],
        path: /^\/v3\/clusters\/[^/]+\/topics\/[^/]+\/records$/,
        requiredScopes: ['external:kafka:write'],
        kafkaTopicScoped: true,
        policyLabel: 'kafka.topic.write',
      },
    ],
  },
};

export function getExternalRequiredScopes(): string[] {
  const scopes = new Set<string>();

  for (const policy of Object.values(EXTERNAL_API_POLICIES)) {
    for (const scope of policy.requiredScopes) {
      scopes.add(scope);
    }

    for (const rule of policy.rules) {
      for (const scope of rule.requiredScopes) {
        scopes.add(scope);
      }
    }
  }

  return [...scopes].sort();
}

@Injectable()
export class ExternalPolicyGuard implements CanActivate {
  constructor(
    private readonly auth: AuthService,
    private readonly logger: LoggerService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<ExternalPolicyRequest>();

    const apiName = String(request.params?.apiName ?? '').toLowerCase();
    if (!apiName) {
      return true;
    }

    const callerScopes = this.auth.mergeCallerScopes(request.user ?? {});
    if (callerScopes.includes('platform:admin')) {
      return true;
    }

    const policy = EXTERNAL_API_POLICIES[apiName];
    if (!policy) {
      return this.deny(`External API '${apiName}' is not allowed by policy`, request);
    }

    const tribeId = request.user?.tribeId ?? request.tribeId;
    if (!tribeId) {
      return this.deny('External API access requires a token with a tribeId claim', request);
    }

    this.assertTribeAllowed(apiName, tribeId, policy.allowlistEnv, request);

    const method = this.normaliseMethod(request.method);
    const downstreamPath = this.normaliseDownstreamPath(request.params?.['0']);

    const matchingRule = policy.rules.find(
      (rule) => rule.methods.includes(method) && rule.path.test(downstreamPath),
    );

    if (!matchingRule) {
      return this.deny(
        `Method '${method}' is not allowed for external API '${apiName}' path '${downstreamPath}'`,
        request,
      );
    }

    const requiredScopes = [...policy.requiredScopes, ...matchingRule.requiredScopes];
    const missingScopes = requiredScopes.filter((scope) => !callerScopes.includes(scope));
    if (missingScopes.length > 0) {
      return this.deny(
        `External API access denied. Missing scopes: ${missingScopes.join(', ')}`,
        request,
      );
    }

    if (matchingRule.kafkaTopicScoped) {
      this.enforceKafkaTopicTenancy(downstreamPath, tribeId, request);
    }

    this.logger.debug(
      `External policy allow api=${apiName} tribe=${tribeId} method=${method} path=${downstreamPath} policy=${matchingRule.policyLabel} correlationId=${request.correlationId ?? 'n/a'}`,
      'ExternalPolicyGuard',
    );

    return true;
  }

  private assertTribeAllowed(
    apiName: string,
    tribeId: string,
    envVar: string,
    request: ExternalPolicyRequest,
  ): void {
    const allowlist = this.resolveAllowlist(envVar);

    if (allowlist === '*') {
      return;
    }

    if (allowlist.size === 0) {
      this.deny(`External API '${apiName}' has no configured allowlist (${envVar})`, request);
    }

    if (!allowlist.has(tribeId)) {
      this.deny(`Tribe '${tribeId}' is not allowlisted for external API '${apiName}'`, request);
    }
  }

  private resolveAllowlist(envVar: string): Set<string> | '*' {
    const raw = process.env[envVar];
    if (!raw) {
      return new Set<string>();
    }

    const entries = raw
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);

    if (entries.includes('*')) {
      return '*';
    }

    return new Set(entries);
  }

  private normaliseMethod(method: string): HttpMethod {
    const normalized = method.toUpperCase();
    const supported: HttpMethod[] = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'];

    if (!supported.includes(normalized as HttpMethod)) {
      throw new ForbiddenError(`Method '${method}' is not allowed for external APIs`);
    }

    return normalized as HttpMethod;
  }

  private normaliseDownstreamPath(rawPath: string | undefined): string {
    const raw = (rawPath ?? '').trim();
    const normalized = `/${raw}`.replace(/\/{2,}/g, '/');

    if (
      normalized.includes('..') ||
      normalized.includes('\\') ||
      /%2e/i.test(normalized) ||
      /%5c/i.test(normalized)
    ) {
      throw new ForbiddenError('Path traversal sequences are not allowed for external API routing');
    }

    return normalized;
  }

  private enforceKafkaTopicTenancy(
    path: string,
    tribeId: string,
    request: ExternalPolicyRequest,
  ): void {
    const match = /^\/v3\/clusters\/[^/]+\/topics\/([^/]+)(?:\/records)?$/.exec(path);
    if (!match) {
      return;
    }

    let topic = match[1];
    try {
      topic = decodeURIComponent(topic);
    } catch {
      // Keep the raw token if decoding fails.
    }

    if (topic.startsWith('__')) {
      this.deny('Kafka internal topics are not accessible via external routing', request);
    }

    const normalizedTribeId = tribeId.toLowerCase().replace(/[^a-z0-9._-]/g, '-');
    const allowedPrefixes = [
      `tribe.${normalizedTribeId}.`,
      `tribe-${normalizedTribeId}.`,
    ];

    if (!allowedPrefixes.some((prefix) => topic.startsWith(prefix))) {
      this.deny(
        `Kafka topic '${topic}' is outside tenant boundary for tribe '${tribeId}'`,
        request,
      );
    }
  }

  private deny(message: string, request: ExternalPolicyRequest): never {
    const apiName = String(request.params?.apiName ?? 'unknown').toLowerCase();
    const wildcardPath = (request.params?.['0'] ?? '').trim();
    const attemptedPath = `/${wildcardPath}`.replace(/\/{2,}/g, '/');
    const tribeId = request.user?.tribeId ?? request.tribeId ?? 'unknown';

    this.logger.warn(
      `External policy deny api=${apiName} tribe=${tribeId} method=${request.method} path=${attemptedPath} reason=${message} correlationId=${request.correlationId ?? 'n/a'}`,
      'ExternalPolicyGuard',
    );

    throw new ForbiddenError(message);
  }
}
