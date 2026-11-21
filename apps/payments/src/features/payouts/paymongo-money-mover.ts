// Sends payouts through PayMongo's transfer API. Every transfer is a batch of one
// (POST /v2/batch_transfers); PayMongo has no idempotency key for transfers, so any response that does
// not prove the transfer was refused is reported as unknown and settled later by lookup.

import { paymongoRequest } from '../../shared/paymongo-client';
import { PayMongoError } from '../../shared/payment-errors';
import type { MerchantAccount } from './merchant-accounts';
import {
  PAYMONGO_BIC,
  type LookupResult,
  type MoneyMover,
  type PayoutDestination,
  type SubmitResult,
  type TransferRequest,
} from './money-mover';

type ProviderTransfer = Record<string, any>;

export class PayMongoMoneyMover implements MoneyMover {
  async submit(request: TransferRequest): Promise<SubmitResult> {
    const wallet = request.account.wallet;
    if (!wallet) return { kind: 'rejected', code: 'wallet_not_configured', message: 'The payout wallet is not configured' };
    const transfer = {
      source_account: { number: wallet.number, name: wallet.name, bic: PAYMONGO_BIC },
      destination_account: destinationAccount(request.destination),
      amount: request.amount,
      currency: 'PHP',
      provider: request.destination.type === 'instapay' ? 'instapay' : 'paymongo',
      reference_number: request.referenceNumber,
      ...(request.callbackUrl ? { callback_url: request.callbackUrl } : {}),
      metadata: request.metadata,
    };
    try {
      const response = await paymongoRequest('/v2/batch_transfers', {
        method: 'POST', body: { transfers: [transfer] }, account: request.account,
      });
      const created = fields(fields(response?.data)?.transfers?.[0]);
      if (!created?.id) return { kind: 'unknown', reason: 'PayMongo accepted the batch without a transfer id' };
      return { kind: 'accepted', transferId: created.id, status: transferStatus(created.status), fee: amountOrNull(created.fee) };
    } catch (error) {
      if (!(error instanceof PayMongoError)) throw error;
      // 4xx means PayMongo refused the request, so nothing was sent; 429 too. Anything else may have been sent.
      if (error.statusCode === 429) return { kind: 'rejected', code: 'rate_limited', message: error.message };
      // 408 (timed out) and 409 (conflict) do not prove the transfer was refused.
      if (error.statusCode >= 400 && error.statusCode < 500 && error.statusCode !== 408 && error.statusCode !== 409) {
        return { kind: 'rejected', code: error.code, message: error.message };
      }
      return { kind: 'unknown', reason: `${error.code}: ${error.message}` };
    }
  }

  async lookup(account: MerchantAccount, key: { transferId: string } | { referenceNumber: string; since: Date }): Promise<LookupResult> {
    if ('transferId' in key) {
      try {
        const response = await paymongoRequest(`/v2/transfers/${encodeURIComponent(key.transferId)}`, { account });
        return found(fields(response?.data));
      } catch (error) {
        if (error instanceof PayMongoError && error.statusCode === 404) return { found: false };
        throw error;
      }
    }
    const response = await paymongoRequest('/v2/batch_transfers?limit=100', { account });
    const batches: ProviderTransfer[] = Array.isArray(response?.data) ? response.data : [];
    for (const batch of batches) {
      for (const candidate of fields(batch)?.transfers ?? []) {
        const transfer = fields(candidate);
        if (transfer?.reference_number === key.referenceNumber) return found(transfer);
      }
    }
    return { found: false };
  }

  async availableBalance(account: MerchantAccount): Promise<number> {
    if (!account.wallet) throw new PayMongoError('The payout wallet is not configured', 409, 'WALLET_NOT_CONFIGURED');
    const response = await paymongoRequest('/v2/wallets/?fields=balance&fields=account', { account });
    const wallets: ProviderTransfer[] = Array.isArray(response?.data) ? response.data : [];
    const wallet = wallets.map(fields).find((candidate) => String(candidate?.account?.account_number) === account.wallet!.number);
    const available = amountOrNull(wallet?.balance?.available);
    if (available === null) throw new PayMongoError('The payout wallet was not found at PayMongo', 409, 'WALLET_NOT_FOUND');
    return available;
  }
}

function destinationAccount(destination: PayoutDestination) {
  return destination.type === 'instapay'
    ? { number: destination.accountNumber, name: destination.accountName, bic: destination.bic }
    : { number: destination.accountNumber, name: destination.accountName, bic: PAYMONGO_BIC };
}

/** PayMongo resources sometimes nest their fields under `attributes`. */
function fields(resource: ProviderTransfer | undefined): ProviderTransfer | undefined {
  if (!resource) return undefined;
  return resource.attributes ? { id: resource.id, ...resource.attributes } : resource;
}

function found(transfer: ProviderTransfer | undefined): LookupResult {
  if (!transfer?.id) return { found: false };
  return {
    found: true,
    transferId: transfer.id,
    status: transferStatus(transfer.status),
    fee: amountOrNull(transfer.fee),
    failureCode: transfer.error_code ?? transfer.failure_code ?? transfer.errors?.[0]?.code ?? null,
  };
}

function transferStatus(status: unknown): 'pending' | 'succeeded' | 'failed' {
  return status === 'succeeded' || status === 'failed' ? status : 'pending';
}

function amountOrNull(value: unknown): number | null {
  const amount = typeof value === 'string' ? Number(value) : value;
  return typeof amount === 'number' && Number.isSafeInteger(amount) ? amount : null;
}
