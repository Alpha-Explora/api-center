export class GovernanceDependencyError extends Error {
  constructor(dependencyName: string) {
    super(`${dependencyName} is required for APICenter governance enforcement`);
    this.name = "GovernanceDependencyError";
  }
}

export function requireGovernanceDependency<T>(
  dependency: T | null | undefined,
  dependencyName: string,
): T {
  if (!dependency) {
    throw new GovernanceDependencyError(dependencyName);
  }

  return dependency;
}
