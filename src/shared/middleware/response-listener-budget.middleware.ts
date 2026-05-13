import { Injectable, NestMiddleware } from "@nestjs/common";
import { NextFunction, Request, Response } from "express";

const RESPONSE_LISTENER_BUDGET = 25;

@Injectable()
export class ResponseListenerBudgetMiddleware implements NestMiddleware {
  use(_req: Request, res: Response, next: NextFunction): void {
    if (
      typeof res.getMaxListeners === "function" &&
      typeof res.setMaxListeners === "function" &&
      res.getMaxListeners() < RESPONSE_LISTENER_BUDGET
    ) {
      res.setMaxListeners(RESPONSE_LISTENER_BUDGET);
    }

    next();
  }
}
