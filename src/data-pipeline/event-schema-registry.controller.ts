import { Controller, Get, Query, Req, UseGuards } from "@nestjs/common";

import { ScopedAdminGuard } from "../auth/guards/scoped-admin.guard";
import { AuthenticatedRequest } from "../types";
import { parsePipelineHealthEnvironment } from "./pipeline-health.dto";
import { EventSchemaRegistryService } from "./event-schema-registry.service";

@Controller("data-pipeline/event-schemas")
@UseGuards(ScopedAdminGuard)
export class EventSchemaRegistryController {
  constructor(private readonly registry: EventSchemaRegistryService) {}

  @Get()
  async listSchemas(
    @Query("environment") environmentParam: string | undefined,
    @Query("tribeId") tribeId: string | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    const environment = parsePipelineHealthEnvironment(environmentParam);
    const data = await this.registry.listRecords({ environment, tribeId });

    return {
      success: true,
      data,
      meta: {
        environment,
        tribeId,
        schemaRegistryVersion: await this.registry.getRegistryVersion(),
        timestamp: new Date().toISOString(),
        correlationId: req.correlationId,
      },
    };
  }
}
