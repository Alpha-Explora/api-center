import { Module } from "@nestjs/common";
import { DatabaseModule } from "@database/database.module";
import { QuotaEvaluationLedgerService } from "./quota-evaluation-ledger.service";
import { QUOTA_EVALUATION_LEDGER } from "./quota-evaluation-ledger.types";

@Module({
  imports: [DatabaseModule],
  providers: [
    QuotaEvaluationLedgerService,
    { provide: QUOTA_EVALUATION_LEDGER, useExisting: QuotaEvaluationLedgerService },
  ],
  exports: [QUOTA_EVALUATION_LEDGER],
})
export class QuotaLedgerModule {}
