import { Global, Module } from "@nestjs/common";
import { DatabaseModule } from "@database/database.module";
import { AuditEventsService } from "./audit-events.service";

/** Owns the apic_audit schema. Every other context records audit events through AuditEventsService. */
@Global()
@Module({
  imports: [DatabaseModule],
  providers: [AuditEventsService],
  exports: [AuditEventsService],
})
export class AuditModule {}
