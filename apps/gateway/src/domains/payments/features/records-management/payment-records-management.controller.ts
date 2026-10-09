import { Controller, Get, Query, Res, UseGuards, BadRequestException } from '@nestjs/common';
import { Response } from 'express';
import { ScopedAdminGuard } from '@auth/guards/scoped-admin.guard';
import { PaymentRecordsManagementService, type AdminPaymentRecordQuery } from './payment-records-management.service';

@Controller('admin/payments/records')
@UseGuards(ScopedAdminGuard)
export class PaymentRecordsManagementController {
  constructor(private readonly records: PaymentRecordsManagementService) {}

  @Get()
  async list(@Query() query: Record<string, unknown>, @Res() response: Response) {
    const projectId = typeof query.projectId === 'string' ? query.projectId.trim() : '';
    const environment = query.environment;
    if (!projectId || (environment !== 'test' && environment !== 'live')) {
      throw new BadRequestException('projectId and environment=test|live are required');
    }
    const parsed: AdminPaymentRecordQuery = {
      projectId, environment,
      ...(typeof query.type === 'string' ? { type: query.type } : {}),
      ...(typeof query.status === 'string' ? { status: query.status } : {}),
      ...(typeof query.createdAfter === 'string' ? { createdAfter: query.createdAfter } : {}),
      ...(typeof query.createdBefore === 'string' ? { createdBefore: query.createdBefore } : {}),
      ...(typeof query.cursor === 'string' ? { cursor: query.cursor } : {}),
      ...(typeof query.limit === 'string' ? { limit: Number(query.limit) } : {}),
    };
    if (query.format === 'csv') {
      response.setHeader('content-type', 'text/csv; charset=utf-8');
      response.setHeader('content-disposition', 'attachment; filename="apicenter-payment-records.csv"');
      response.write(paymentRecordsCsvHeader());
      let cursor = parsed.cursor;
      do {
        const page = await this.records.list({ ...parsed, limit: 200, cursor });
        for (const record of page.records) response.write(paymentRecordCsvRow(record));
        cursor = page.nextCursor;
      } while (cursor);
      response.end();
      return;
    }
    const page = await this.records.list(parsed);
    response.json({ success: true, data: page });
  }
}

const PAYMENT_RECORD_COLUMNS = ['createdAt', 'type', 'id', 'projectId', 'environment', 'referenceId', 'relatedResourceId', 'amountMinor', 'currency', 'status'];
const csvCell = (value: unknown, column: string) => {
  let text = value == null ? '' : String(value);
  const isIntegerAmount = column === 'amountMinor' && /^-?\d+$/.test(text);
  // Neutralize formula-leading text without turning numeric amounts into text.
  if (!isIntegerAmount && /^[\u0000-\u0020\uFEFF]*[=+\-@]/.test(text)) {
    text = "'" + text;
  }
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};
const paymentRecordsCsvHeader = () => `${PAYMENT_RECORD_COLUMNS.join(',')}\r\n`;
const paymentRecordCsvRow = (record: Record<string, unknown>) =>
  `${PAYMENT_RECORD_COLUMNS.map((column) => csvCell(record[column], column)).join(',')}\r\n`;
