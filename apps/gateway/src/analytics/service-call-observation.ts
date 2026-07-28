export type ServiceCallOutcome =
  | "allowed"
  | "blocked"
  | "success"
  | "client_error"
  | "server_error"
  | "timeout"
  | "provider_error";

export interface ServiceCallObservation {
  correlation_id: string;
  request_id: string;
  environment: string;
  caller_type:
    | "service"
    | "tribe"
    | "client_application"
    | "system"
    | "unknown";
  caller_id: string;
  source_service_id: string;
  target_type:
    | "api_service"
    | "shared_service"
    | "gateway_route"
    | "data_pipeline"
    | "provider";
  target_service_id?: string;
  shared_service_id?: string;
  route_family: string;
  http_method: string;
  status_code: number;
  outcome: ServiceCallOutcome;
  latency_ms: number;
  quota_evaluation_id?: string;
  audit_event_id?: string;
  rollup_key: string;
}
