export type ManagementAuthMode = "local-dev" | "google";
export type ManagementEnvironment = "test" | "live";
export type ManagementRole = "admin" | "operator" | "observer";

export type ManagementSession = {
  userId: string;
  email: string;
  name?: string;
  role: ManagementRole;
  source: ManagementAuthMode;
};

export type ManagementAuthConfig = {
  mode: ManagementAuthMode;
  environment: ManagementEnvironment;
  publicBaseUrl: string;
  googleClientId?: string;
};

type EnvLike = Record<string, string | undefined>;

export type GoogleClaims = {
  sub?: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
};

export function getManagementAuthConfig(env: EnvLike = process.env): ManagementAuthConfig {
  const mode = resolveManagementAuthMode(env);
  const environment = (env.MANAGEMENT_ENVIRONMENT ?? "test") as ManagementEnvironment;

  if (mode !== "local-dev" && mode !== "google") {
    throw new Error(`Unsupported MANAGEMENT_AUTH_MODE: ${mode}`);
  }

  if (environment !== "test" && environment !== "live") {
    throw new Error(`Unsupported MANAGEMENT_ENVIRONMENT: ${environment}`);
  }

  if (mode === "local-dev" && isDeployedOrLive(env, environment)) {
    throw new Error("local-dev management auth is not allowed outside local test development");
  }

  if (mode === "google") {
    if (!env.GOOGLE_CLIENT_ID && !env.NEXT_PUBLIC_GOOGLE_CLIENT_ID) {
      throw new Error("GOOGLE_CLIENT_ID or NEXT_PUBLIC_GOOGLE_CLIENT_ID is required");
    }
  }

  return {
    mode,
    environment,
    publicBaseUrl: env.MANAGEMENT_PUBLIC_BASE_URL ?? "http://localhost:3000",
    googleClientId: env.GOOGLE_CLIENT_ID ?? env.NEXT_PUBLIC_GOOGLE_CLIENT_ID,
  };
}

function resolveManagementAuthMode(env: EnvLike): ManagementAuthMode {
  const rawMode = env.MANAGEMENT_AUTH_MODE?.trim();
  if (rawMode) {
    return rawMode as ManagementAuthMode;
  }

  const environment = env.MANAGEMENT_ENVIRONMENT ?? "test";
  if (isDeployedOrLive(env, environment as ManagementEnvironment)) {
    throw new Error("MANAGEMENT_AUTH_MODE is required outside local test development");
  }

  return "local-dev";
}

function isDeployedOrLive(env: EnvLike, environment: ManagementEnvironment) {
  if (environment === "live" || env.VERCEL === "1" || env.RENDER === "true") {
    return true;
  }

  const publicBaseUrl = env.MANAGEMENT_PUBLIC_BASE_URL?.trim();
  if (!publicBaseUrl || publicBaseUrl.includes("<")) {
    return false;
  }

  try {
    const hostname = new URL(publicBaseUrl).hostname.toLowerCase();
    return !["localhost", "127.0.0.1", "::1"].includes(hostname);
  } catch {
    return false;
  }
}

export function createLocalDevSession(): ManagementSession {
  return {
    userId: "local-dev",
    email: "local-dev@api-center.internal",
    name: "Local Developer",
    role: "admin",
    source: "local-dev",
  };
}

export function resolveManagementSessionFromGoogleClaims(
  claims: GoogleClaims,
): ManagementSession {
  if (!claims.email || claims.email_verified !== true) {
    throw new Error("Verified Google email is required");
  }

  const email = claims.email.trim().toLowerCase();

  return {
    userId: claims.sub ?? email,
    email,
    name: claims.name,
    role: "admin",
    source: "google",
  };
}
