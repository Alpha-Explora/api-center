import { ValidationError } from "../shared/errors";
import type { HttpMethod } from "../types";

export const HTTP_METHODS = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
] as const;

export function normalizeHttpMethod(method: string): HttpMethod {
  const normalized = method.toUpperCase();
  if ((HTTP_METHODS as readonly string[]).includes(normalized)) {
    return normalized as HttpMethod;
  }

  throw new ValidationError(`Unsupported HTTP method: ${method}`);
}
