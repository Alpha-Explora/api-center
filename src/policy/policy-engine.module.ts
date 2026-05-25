import { Global, Module } from "@nestjs/common";
import { PolicyEngineService } from "./policy-engine.service";

@Global()
@Module({
  providers: [PolicyEngineService],
  exports: [PolicyEngineService],
})
export class PolicyEngineModule {}
