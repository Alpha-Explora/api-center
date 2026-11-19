import { readSharedServiceCaller, sameProject, SharedServiceCallerError } from '@apicenter/runtime';

const requestWith = (values: Record<string, string>) => ({ get: (name: string) => values[name] });
const forgedHeaders = {
  'X-Tribe-Id': 'tribe-a',
  'X-APICenter-Project-Id': 'project-a',
  'X-APICenter-Source-Service-Id': 'service-a',
  'X-APICenter-Environment': 'live',
};

describe('readSharedServiceCaller without a signed context', () => {
  it('refuses the call in production, whatever identity headers it carries', () => {
    expect(() => readSharedServiceCaller(requestWith(forgedHeaders), { production: true })).toThrow(SharedServiceCallerError);
    expect(() => readSharedServiceCaller(requestWith({}), { production: true })).toThrow('signed APICenter runtime context is required');
  });

  it('acts as the fixed local caller outside production and ignores identity headers', () => {
    expect(readSharedServiceCaller(requestWith(forgedHeaders), { production: false })).toEqual({
      tribeId: 'local',
      projectId: 'local',
      serviceId: 'local',
      environment: 'test',
      model: 'local',
    });
  });
});

describe('sameProject', () => {
  const caller = { tribeId: 'tribe-a', projectId: 'project-a', serviceId: 'service-a', environment: 'live' as const, model: 'application' as const };

  it('matches a different application in the same project and environment', () => {
    expect(sameProject(caller, { ...caller, serviceId: 'service-b' })).toBe(true);
  });

  it('does not match another project or another environment', () => {
    expect(sameProject(caller, { ...caller, projectId: 'project-b' })).toBe(false);
    expect(sameProject(caller, { ...caller, environment: 'test' })).toBe(false);
  });
});
