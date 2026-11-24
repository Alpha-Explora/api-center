// An in-memory money mover for development, tests and mock-mode runtimes. Transfers are accepted as
// pending and reported as succeeded on lookup; tests can force the next submission to fail.

import { randomUUID } from 'node:crypto';
import { isMockMode, simulatesTestWallets } from '../../shared/paymongo-client';
import type { MerchantAccount } from './merchant-accounts';
import type { LookupResult, MoneyMover, SubmitResult, TransferRequest } from './money-mover';
import { PayMongoMoneyMover } from './paymongo-money-mover';
import { SimulatedMoneyMover } from './simulated-money-mover';

export class MockMoneyMover implements MoneyMover {
  private readonly transfers = new Map<string, { referenceNumber: string }>();
  private nextFailure: 'rejected' | 'unknown' | undefined;
  private balance = Number(process.env.PAYOUT_MOCK_BALANCE || 100_000_000);
  readonly submitted: TransferRequest[] = [];

  failNext(kind: 'rejected' | 'unknown'): void {
    this.nextFailure = kind;
  }

  setBalance(centavos: number): void {
    this.balance = centavos;
  }

  async submit(request: TransferRequest): Promise<SubmitResult> {
    const failure = this.nextFailure;
    this.nextFailure = undefined;
    if (failure === 'rejected') return { kind: 'rejected', code: 'invalid_destination_account', message: 'Mock rejection' };
    this.submitted.push(request);
    const transferId = `tr_mock_${randomUUID().replace(/-/g, '')}`;
    this.transfers.set(transferId, { referenceNumber: request.referenceNumber });
    // An unknown outcome still records the transfer: the money may have moved, which is what lookup must find.
    if (failure === 'unknown') return { kind: 'unknown', reason: 'Mock timeout' };
    return { kind: 'accepted', transferId, status: 'pending', fee: 1_000 };
  }

  async lookup(_account: MerchantAccount, key: { transferId: string } | { referenceNumber: string; since: Date }): Promise<LookupResult> {
    const entry = 'transferId' in key
      ? (this.transfers.has(key.transferId) ? key.transferId : undefined)
      : [...this.transfers].find(([, value]) => value.referenceNumber === key.referenceNumber)?.[0];
    if (!entry) return { found: false };
    return { found: true, transferId: entry, status: 'succeeded', fee: 1_000, failureCode: null };
  }

  async availableBalance(_account: MerchantAccount): Promise<number> {
    return this.balance;
  }
}

export function createMoneyMover(): MoneyMover {
  if (isMockMode()) return new MockMoneyMover();
  return simulatesTestWallets() ? new SimulatedMoneyMover() : new PayMongoMoneyMover();
}
