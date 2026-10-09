import { readSharedServiceCaller, sameProject, SharedServiceCallerError } from '@apicenter/runtime';

const gatewayHeaders = {
  'X-Tribe-Id': 'tribe-a',
  'X-APICenter-Project-Id': 'project-a',
  'X-APICenter-Source-Service-Id': 'service-a',
  'X-APICenter-Environment': 'live',
};

function requestWith(values: Record<string, string>) {
  return { get: (name: string) => values[name] };
}

describe('readSharedServiceCaller', () => {
  it('reads the caller headers the gateway sets', () => {
    expect(readSharedServiceCaller(requestWith(gatewayHeaders), { production: true })).toEqual({
      tribeId: 'tribe-a',
      projectId: 'project-a',
      serviceId: 'service-a',
      environment: 'live',
    });
  });

  it('rejects a production request that is missing a caller header', () => {
    expect(() => readSharedServiceCaller(requestWith({ 'X-Tribe-Id': 'tribe-a' }), { production: true }))
      .toThrow(SharedServiceCallerError);
    expect(() => readSharedServiceCaller(requestWith({ 'X-Tribe-Id': 'tribe-a' }), { production: true }))
      .toThrow('X-APICenter-Project-Id');
  });

  it('treats a blank caller header as missing in production', () => {
    expect(() => readSharedServiceCaller(requestWith({ ...gatewayHeaders, 'X-APICenter-Project-Id': '   ' }), { production: true }))
      .toThrow('X-APICenter-Project-Id');
  });

  it('fills local defaults outside production', () => {
    expect(readSharedServiceCaller(requestWith({}), { production: false })).toEqual({
      tribeId: 'local',
      projectId: 'local',
      serviceId: 'local',
      environment: 'test',
    });
  });

  it('rejects an environment that is neither test nor live', () => {
    expect(() => readSharedServiceCaller(requestWith({ ...gatewayHeaders, 'X-APICenter-Environment': 'staging' }), { production: true }))
      .toThrow('X-APICenter-Environment must be test or live');
  });
});

describe('sameProject', () => {
  const caller = { tribeId: 'tribe-a', projectId: 'project-a', serviceId: 'service-a', environment: 'live' as const };

  it('matches a different service in the same project and environment', () => {
    expect(sameProject(caller, { ...caller, serviceId: 'service-b' })).toBe(true);
  });

  it('does not match another project or another environment', () => {
    expect(sameProject(caller, { ...caller, projectId: 'project-b' })).toBe(false);
    expect(sameProject(caller, { ...caller, environment: 'test' })).toBe(false);
  });
});

