import axios from 'axios';
import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { TENANCY_DIRECTORY, type TenancyDirectory } from '@registry/tenancy.types';

export type AdminPaymentRecordQuery = {
  projectId: string;
  environment: 'test' | 'live';
  type?: string;
  status?: string;
  createdAfter?: string;
  createdBefore?: string;
  limit?: number;
  cursor?: string;
};

@Injectable()
export class PaymentRecordsManagementService {
  constructor(@Inject(TENANCY_DIRECTORY) private readonly tenancy: TenancyDirectory) {}

  async list(query: AdminPaymentRecordQuery): Promise<{ records: Array<Record<string, unknown>>; nextCursor?: string }> {
    const placement = this.tenancy.resolveProject(query.projectId);
    if (!placement) {
      const error = new Error('Unknown payment project');
      Object.assign(error, { status: 404 });
      throw error;
    }
    const environment = query.environment;
    const baseUrl = process.env.APICENTER_PAYMENTS_URL
      || (environment === 'live' ? process.env.SHARED_SERVICE_ROUTE_PAYMENT_LIVE : process.env.SHARED_SERVICE_ROUTE_PAYMENT_TEST);
    const internalToken = (environment === 'live' ? process.env.APICENTER_PAYMENTS_INTERNAL_TOKEN_LIVE
      : process.env.APICENTER_PAYMENTS_INTERNAL_TOKEN_TEST) || process.env.APICENTER_PAYMENTS_INTERNAL_TOKEN;
    if (!baseUrl || !internalToken) throw new ServiceUnavailableException('APICenter payments runtime is not configured');
    const response = await axios.get(`${baseUrl.replace(/\/$/, '')}/admin/payments/records`, {
      params: { ...query },
      headers: {
        Authorization: `Bearer ${internalToken}`,
        'X-APICenter-Owner-Tribe-ID': placement.tribe.tribeId,
        'X-APICenter-Project-ID': query.projectId,
        'X-APICenter-Consumer-Service-ID': 'apicenter-management',
        'X-APICenter-Environment': environment,
      },
      validateStatus: () => true,
      timeout: Number(process.env.APICENTER_PAYMENTS_TIMEOUT_MS || 15000),
    });
    const payload = response.data as { success?: boolean; data?: { records?: Array<Record<string, unknown>>; nextCursor?: string }; error?: unknown };
    const pageRecords = payload.data?.records;
    if (response.status >= 400 || !payload.success || !payload.data || !Array.isArray(pageRecords)) {
      const error = new Error('Payment records could not be loaded');
      Object.assign(error, { status: response.status, details: payload.error });
      throw error;
    }
    return { records: pageRecords, ...(payload.data.nextCursor ? { nextCursor: payload.data.nextCursor } : {}) };
  }
}
