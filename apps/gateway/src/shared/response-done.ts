import type { Response } from "express";

/** Nginx's code for a client that disconnected before the response finished. */
export const CLIENT_CLOSED_REQUEST = 499;

/**
 * Calls `done` once with the status the client actually received. Interceptors see a failed
 * handler before the exception filter sets the status, so reading `statusCode` there reports
 * Express's default 200; the response's own `finish` event carries the final status.
 */
export function onResponseDone(response: Response, done: (statusCode: number) => void): void {
  let reported = false;
  const report = () => {
    if (reported) return;
    reported = true;
    done(response.writableFinished ? response.statusCode : CLIENT_CLOSED_REQUEST);
  };
  response.once("finish", report);
  response.once("close", report);
}
