export interface GovernancePrincipal {
  tribeId: string;
  environment: "test" | "live";
  scopes: string[];
}

export interface GovernancePolicyEvaluation {
  allowed: boolean;
  reason?: string;
  code?: string;
}
