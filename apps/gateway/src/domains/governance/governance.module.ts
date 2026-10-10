import { Module } from '@nestjs/common';
import { QuotasModule } from './quotas/quotas.module';
import { ApprovalsModule } from './approvals/approvals.module';
import { PolicyEngineModule } from './policy/policy-engine.module';
import { EntitlementsModule } from './entitlements/entitlements.module';
import { DeveloperPortalModule } from './developer-portal/developer-portal.module';
import { ApiSubscriptionsModule } from './api-subscriptions/api-subscriptions.module';

@Module({
  imports: [
    QuotasModule,
    ApprovalsModule,
    PolicyEngineModule,
    EntitlementsModule,
    DeveloperPortalModule,
    ApiSubscriptionsModule,
  ],
  exports: [
    QuotasModule,
    ApprovalsModule,
    PolicyEngineModule,
    EntitlementsModule,
    DeveloperPortalModule,
    ApiSubscriptionsModule,
  ],
})
export class GovernanceModule {}
