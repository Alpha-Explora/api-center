type EnvironmentBannerProps = {
  environment: "test" | "live";
  authMode: "local-dev" | "google";
};

export function EnvironmentBanner({ environment, authMode }: EnvironmentBannerProps) {
  if (authMode === "local-dev") {
    return (
      <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
        <strong>Local development</strong>
        <span className="ml-2">Do not use this auth mode in deployed environments.</span>
      </div>
    );
  }

  if (environment === "live") {
    return (
      <div className="border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-900">
        <strong>Live environment</strong>
        <span className="ml-2">Writes require confirmation and reason.</span>
      </div>
    );
  }

  return (
    <div className="border-b border-sky-200 bg-sky-50 px-4 py-2 text-sm text-sky-900">
      <strong>Test environment</strong>
      <span className="ml-2">Provider-impacting actions still require review.</span>
    </div>
  );
}
