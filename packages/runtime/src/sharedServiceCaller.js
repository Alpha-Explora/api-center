const { RuntimeContextError, loadRuntimeContextKeys, verifyRuntimeContext } = require('./runtimeContext');

const RUNTIME_CONTEXT_HEADER = 'X-APICenter-Context';
const CALLER_HEADERS = Object.freeze({
  tribeId: 'X-Tribe-Id',
  projectId: 'X-APICenter-Project-Id',
  serviceId: 'X-APICenter-Source-Service-Id',
  environment: 'X-APICenter-Environment',
});

const ENVIRONMENTS = new Set(['test', 'live']);
const LOCAL_DEFAULTS = Object.freeze({
  tribeId: 'local',
  projectId: 'local',
  serviceId: 'local',
  environment: 'test',
});

class SharedServiceCallerError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SharedServiceCallerError';
  }
}

function headerValue(req, name) {
  const raw = typeof req.get === 'function' ? req.get(name) : req.headers?.[name.toLowerCase()];
  return typeof raw === 'string' ? raw.trim() : '';
}

let cachedKeys;
function defaultContextKeys() {
  if (!cachedKeys) cachedKeys = loadRuntimeContextKeys();
  return cachedKeys;
}

/**
 * Returns the verified control-plane application context, or undefined when the request carries
 * none. A present context that fails verification throws: it never degrades to "absent".
 */
function readRuntimeApplicationContext(req, options = {}) {
  const { runtimeAudience, contextKeys, now } = options;
  const signedContext = headerValue(req, RUNTIME_CONTEXT_HEADER);
  if (!signedContext) return undefined;
  try {
    return verifyRuntimeContext(signedContext, {
      audience: runtimeAudience,
      keys: contextKeys ?? defaultContextKeys(),
      ...(now === undefined ? {} : { now }),
    });
  } catch (error) {
    const reason = error instanceof RuntimeContextError ? error.message : 'Runtime context could not be verified';
    throw new SharedServiceCallerError(reason);
  }
}

/**
 * Reads the caller the gateway authenticated for this request.
 *
 * A control-plane application call carries a signed `X-APICenter-Context`. When that header is
 * present it is the only source of identity: it must verify for this runtime's audience, and the
 * legacy identity headers are ignored. A present but invalid context is rejected; it never falls
 * back to headers.
 *
 * Legacy callers send plain identity headers. Production requires every one of them. Other
 * environments fill missing headers with local defaults so direct calls and tests keep working.
 */
function readSharedServiceCaller(req, options = {}) {
  const { production = process.env.NODE_ENV === 'production' } = options;
  const context = readRuntimeApplicationContext(req, options);
  if (context) {
    // The organization fills the owner-group slot that legacy callers fill with their tribe.
    // Project and application IDs are prefixed (prj_, app_) and cannot collide with legacy slugs.
    return {
      tribeId: context.organizationId,
      projectId: context.projectId,
      serviceId: context.applicationId,
      environment: context.environmentKind,
      model: 'application',
      organizationId: context.organizationId,
      environmentId: context.environmentId,
      applicationId: context.applicationId,
      action: context.action,
      requestId: context.requestId,
    };
  }

  const caller = {};
  const missing = [];
  for (const [field, header] of Object.entries(CALLER_HEADERS)) {
    const value = headerValue(req, header);
    if (value) {
      caller[field] = value;
    } else if (production) {
      missing.push(header);
    } else {
      caller[field] = LOCAL_DEFAULTS[field];
    }
  }
  if (missing.length > 0) {
    throw new SharedServiceCallerError('Missing caller headers: ' + missing.join(', '));
  }
  if (!ENVIRONMENTS.has(caller.environment)) {
    throw new SharedServiceCallerError('X-APICenter-Environment must be test or live');
  }
  return caller;
}

/**
 * Identity fields for createScopedIdempotencyKey. Application callers use their verified context;
 * legacy callers keep the header-derived values so existing idempotency records still match.
 */
function callerIdempotencyScope(caller, req) {
  if (caller.model === 'application') {
    return { sourceServiceId: caller.serviceId, tribeId: caller.tribeId, environment: caller.environment };
  }
  return {
    sourceServiceId: headerValue(req, CALLER_HEADERS.serviceId) || undefined,
    tribeId: headerValue(req, CALLER_HEADERS.tribeId) || undefined,
    environment: headerValue(req, CALLER_HEADERS.environment) || undefined,
  };
}

/**
 * Express middleware for runtimes that do not otherwise read caller identity: a request carrying a
 * signed context must verify for this runtime, or it is rejected with 403.
 */
function createRuntimeContextGate(runtimeAudience) {
  return (req, res, next) => {
    try {
      req.apicenterApplicationContext = readRuntimeApplicationContext(req, { runtimeAudience });
      next();
    } catch (error) {
      res.status(403).json({
        success: false,
        error: { code: 'CALLER_CONTEXT_REQUIRED', message: error instanceof Error ? error.message : 'Runtime context is invalid' },
      });
    }
  };
}

/**
 * True when both callers belong to the same project and environment. Any service in the project
 * can read the records another service in that project created. Tribe is implied by the project.
 */
function sameProject(left, right) {
  return left.projectId === right.projectId && left.environment === right.environment;
}

module.exports = {
  SharedServiceCallerError,
  readSharedServiceCaller,
  readRuntimeApplicationContext,
  callerIdempotencyScope,
  createRuntimeContextGate,
  sameProject,
  RUNTIME_CONTEXT_HEADER,
};
