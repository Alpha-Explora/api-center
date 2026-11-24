import { Controller, Delete, Get, Param, Put, Req, UseGuards } from "@nestjs/common";
import { ConsoleActorGuard, type ConsoleRequest } from "./console-actor.guard";
import { requireOperatorPerson } from "./console-access.policy";
import { actorOf, emailSchema, parse } from "./console-request";
import { PlatformOperatorsService } from "./platform-operators.service";

@Controller("admin/control-plane/platform/operators")
@UseGuards(ConsoleActorGuard)
export class PlatformOperatorsController {
  constructor(private readonly operators: PlatformOperatorsService) {}

  @Get()
  async list(@Req() req: ConsoleRequest) {
    requireOperatorPerson(actorOf(req));
    return { success: true, data: await this.operators.list() };
  }

  @Put(":email")
  async add(@Param("email") email: string, @Req() req: ConsoleRequest) {
    const actor = requireOperatorPerson(actorOf(req));
    await this.operators.add(parse(emailSchema, email, "email"), actor);
    return { success: true };
  }

  @Delete(":email")
  async remove(@Param("email") email: string, @Req() req: ConsoleRequest) {
    const actor = requireOperatorPerson(actorOf(req));
    await this.operators.remove(parse(emailSchema, email, "email"), actor);
    return { success: true };
  }
}
