export function allowQueryParams(request: Request, allowlist: string[]) {
  const url = new URL(request.url);
  const params = new URLSearchParams();

  for (const key of allowlist) {
    const value = url.searchParams.get(key);
    if (value) params.set(key, value);
  }

  return params;
}

export function querySuffix(params: URLSearchParams) {
  const value = params.toString();
  return value ? `?${value}` : "";
}
