import { Module } from "@nestjs/common";
import { AuthModule } from "@auth/auth.module";
import { RequestDiagnosticsController } from "./request-diagnostics.controller";

/** Redacted request diagnostics by request ID, for operators. */
@Module({
  imports: [AuthModule],
  controllers: [RequestDiagnosticsController],
})
export class DiagnosticsModule {}
