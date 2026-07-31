import { Global, Module, forwardRef } from "@nestjs/common";
import { AuthModule } from "@auth/auth.module";
import { DatabaseModule } from "@database/database.module";
import { ApprovalRequestController } from "./approval-request.controller";
import { ApprovalRequestService } from "./approval-request.service";

@Global()
@Module({
  imports: [forwardRef(() => AuthModule), DatabaseModule],
  controllers: [ApprovalRequestController],
  providers: [ApprovalRequestService],
  exports: [ApprovalRequestService],
})
export class ApprovalsModule {}
