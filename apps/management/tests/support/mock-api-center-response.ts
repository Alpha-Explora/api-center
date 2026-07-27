export function mockApiCenterResponse<T>(data: T, init?: ResponseInit) {
  return Response.json(
    {
      success: true,
      data,
    },
    init,
  );
}

export function mockApiCenterError(message: string, init: ResponseInit = { status: 500 }) {
  return Response.json(
    {
      success: false,
      error: message,
    },
    init,
  );
}
