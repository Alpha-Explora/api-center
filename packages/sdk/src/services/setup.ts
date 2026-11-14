import type { ProjectSetupStatusResponse } from '@alpha-explora/apicenter-contracts';
import type { RequestOptions } from '../types';
import { ApiCenterTransport } from '../internal/transport';

export class SetupClient {
  constructor(private readonly transport: ApiCenterTransport) {}

  /** Read setup checks for the project and environment bound to the service token. */
  status(options?: RequestOptions): Promise<ProjectSetupStatusResponse> {
    return this.transport.request({ path: '/api/v1/setup/status', method: 'GET', credential: 'service', options });
  }
}
