import {
  BadRequestException,
  Controller,
  Get,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ScopedAdminGuard } from "@auth/guards/scoped-admin.guard";
import {
  diagnosticQuery,
  RequestDiagnosticsStore,
} from "@shared/request-diagnostics.store";

@Controller("admin/operations/requests")
@UseGuards(ScopedAdminGuard)
export class RequestDiagnosticsController {
  constructor(private readonly diagnostics: RequestDiagnosticsStore) {}
  @Get()
  async list(@Query() query: unknown) {
    const parsed = diagnosticQuery.safeParse(query);
    if (!parsed.success)
      throw new BadRequestException(
        "A valid environment and bounded time window are required",
      );
    return { success: true, data: await this.diagnostics.list(parsed.data) };
  }
}
