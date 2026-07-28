import { ServiceUnavailableException } from "@nestjs/common";

export class DataPipelineDisabledError extends ServiceUnavailableException {
  constructor(operation: string) {
    super(`Data pipeline is disabled: ${operation}`);
    this.name = "DataPipelineDisabledError";
  }
}

export function dataPipelineDisabled(operation: string): never {
  throw new DataPipelineDisabledError(operation);
}
