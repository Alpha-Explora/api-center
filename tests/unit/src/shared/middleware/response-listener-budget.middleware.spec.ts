import { ResponseListenerBudgetMiddleware } from "../../../../../apps/gateway/src/shared/middleware/response-listener-budget.middleware";

describe("ResponseListenerBudgetMiddleware", () => {
  it("raises the ServerResponse listener budget before downstream middleware attaches listeners", () => {
    const middleware = new ResponseListenerBudgetMiddleware();
    const next = jest.fn();
    const res = {
      getMaxListeners: jest.fn().mockReturnValue(10),
      setMaxListeners: jest.fn(),
    };

    middleware.use({} as any, res as any, next);

    expect(res.setMaxListeners).toHaveBeenCalledWith(25);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("does not lower an already larger listener budget", () => {
    const middleware = new ResponseListenerBudgetMiddleware();
    const next = jest.fn();
    const res = {
      getMaxListeners: jest.fn().mockReturnValue(50),
      setMaxListeners: jest.fn(),
    };

    middleware.use({} as any, res as any, next);

    expect(res.setMaxListeners).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });
});
