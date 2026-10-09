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

/**
 * Reads the caller the gateway authenticated for this request. Production requires every
 * caller header. Other environments fill missing headers with local defaults so direct calls
 * and tests keep working.
 */
function readSharedServiceCaller(req, { production = process.env.NODE_ENV === 'production' } = {}) {
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
 * True when both callers belong to the same project and environment. Any service in the project
 * can read the records another service in that project created. Tribe is implied by the project.
 */
function sameProject(left, right) {
  return left.projectId === right.projectId && left.environment === right.environment;
}

module.exports = { SharedServiceCallerError, readSharedServiceCaller, sameProject };
