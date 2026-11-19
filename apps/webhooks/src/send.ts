// One HTTPS POST to a consumer endpoint: public addresses only (checked at connect), no redirects
// followed, a hard timeout, and at most a small slice of the response read.
import { request } from "node:https";
import { publicOnlyLookup } from "./public-network";

export interface SendResult {
  status: number;
  /** The start of the response body, for the delivery log. */
  responseSnippet: string;
}

export type Sender = (url: string, headers: Record<string, string>, body: string) => Promise<SendResult>;

const RESPONSE_LIMIT = 2048;

export function createHttpsSender(options: { timeoutMs?: number } = {}): Sender {
  const timeoutMs = options.timeoutMs ?? 10_000;
  return (url, headers, body) =>
    new Promise((resolve, reject) => {
      const target = new URL(url);
      if (target.protocol !== "https:") return reject(new Error("Webhook URLs must use https"));
      const req = request(
        target,
        {
          method: "POST",
          headers: { ...headers, "content-length": Buffer.byteLength(body).toString() },
          lookup: publicOnlyLookup,
          timeout: timeoutMs,
        },
        (res) => {
          let snippet = "";
          const done = () => resolve({ status: res.statusCode ?? 0, responseSnippet: snippet });
          res.setEncoding("utf8");
          res.on("data", (chunk: string) => {
            snippet += chunk.slice(0, RESPONSE_LIMIT - snippet.length);
            // The status is all that decides the outcome; stop reading a large body.
            if (snippet.length >= RESPONSE_LIMIT) {
              done();
              res.destroy();
            }
          });
          res.on("end", done);
          res.on("error", reject);
        },
      );
      req.on("timeout", () => req.destroy(new Error(`Webhook endpoint did not answer within ${timeoutMs} ms`)));
      req.on("error", reject);
      req.end(body);
    });
}
