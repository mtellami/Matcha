let csrf = "";
export function setCsrf(value: string) {
  csrf = value;
}
export class ApiError extends Error {
  status: number;
  fields: Record<string, string>;
  constructor(
    message: string,
    status: number,
    fields: Record<string, string> = {},
  ) {
    super(message);
    this.status = status;
    this.fields = fields;
  }
}
export async function api<T = { message: string }>(
  path: string,
  method = "GET",
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const form = body instanceof FormData;
  const response = await fetch("/api/v1" + path, {
    method,
    credentials: "same-origin",
    signal,
    headers: {
      ...(!form && body !== undefined
        ? { "Content-Type": "application/json" }
        : {}),
      "X-CSRF-Token": csrf,
    },
    body: body === undefined ? undefined : form ? body : JSON.stringify(body),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok)
    throw new ApiError(
      data?.error?.message || `Request failed (${response.status})`,
      response.status,
      data?.error?.fields &&
      typeof data.error.fields === "object" &&
      !Array.isArray(data.error.fields)
        ? Object.fromEntries(
            Object.entries(data.error.fields).filter(
              (entry): entry is [string, string] =>
                typeof entry[1] === "string",
            ),
          )
        : {},
    );
  if (data === null)
    throw new ApiError(
      "The server returned an unexpected response",
      response.status,
    );
  return data as T;
}
