const { RuntimeContextError, loadRuntimeContextKeys, verifyRuntimeContext } = require('./runtimeContext');

const RUNTIME_CONTEXT_HEADER = 'X-APICenter-Context';

/** The caller for a direct call to a runtime on a developer machine, where no gateway signs. */
const LOCAL_CALLER = Object.freeze({
  tribeId: 'local',
  projectId: 'local',
  serviceId: 'local',
  environment: 'test',
  model: 'local',
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
 * Reads the caller the gateway authenticated for this request, from its signed
 * `X-APICenter-Context`. The context must verify for this runtime's audience. Production requires
 * it; outside production a request without one acts as a fixed local caller.
 */
function readSharedServiceCaller(req, options = {}) {
  const { production = process.env.NODE_ENV === 'production' } = options;
  const context = readRuntimeApplicationContext(req, options);
  if (!context) {
    if (production) throw new SharedServiceCallerError('A signed APICenter runtime context is required');
    return { ...LOCAL_CALLER };
  }
  // Records are scoped to the resolved resource owner: the organization and project.
  return {
    tribeId: context.ownerGroupId,
    projectId: context.ownerProjectId,
    serviceId: context.applicationId,
    environment: context.environmentKind,
    model: 'application',
    organizationId: context.organizationId,
    environmentId: context.environmentId,
    applicationId: context.applicationId,
    action: context.action,
    requestId: context.requestId,
    suppressDelivery: context.suppressDelivery === true,
    ...(context.projectName ? { projectName: context.projectName } : {}),
  };
}

/** Identity fields for createScopedIdempotencyKey, from the caller. */
function callerIdempotencyScope(caller) {
  return { sourceServiceId: caller.serviceId, tribeId: caller.tribeId, environment: caller.environment };
}

/**
 * Express middleware for runtimes that do not otherwise read caller identity. The signed context
 * must verify for this runtime, or the request is rejected with 403. Production requires it.
 */
function createRuntimeContextGate(runtimeAudience, { production = process.env.NODE_ENV === 'production' } = {}) {
  return (req, res, next) => {
    try {
      const context = readRuntimeApplicationContext(req, { runtimeAudience });
      if (!context && production) throw new SharedServiceCallerError('A signed APICenter runtime context is required');
      req.apicenterApplicationContext = context;
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
