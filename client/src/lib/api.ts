import { getAccessToken } from "@privy-io/react-auth";
import { cleanEnv } from "./env.ts";

/**
 * Empty default → use the Vite dev proxy in development (see
 * `client/vite.config.ts`'s `server.proxy["/api"]`). In production
 * `VITE_API_BASE_URL` should be set explicitly to the API host.
 */
const BASE: string = cleanEnv(import.meta.env.VITE_API_BASE_URL as string | undefined);

/** The resolved API origin (empty in dev → Vite proxy). Exposed for the
 *  streaming agent client, which can't use the JSON `api` helper. */
export const API_BASE = BASE;

export class ApiError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

interface ApiResponseError {
  error?: string;
  code?: string;
  details?: unknown;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await getAccessToken();
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const res = await fetch(`${BASE}${path}`, { ...init, headers });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as ApiResponseError;
    throw new ApiError(
      res.status,
      body.code ?? "UNKNOWN",
      body.error ?? `Request failed: ${String(res.status)}`,
      body.details,
    );
  }
  return (await res.json()) as T;
}

export const api = {
  get<T>(path: string): Promise<T> {
    return request<T>(path, { method: "GET" });
  },
  post<T>(path: string, body: unknown): Promise<T> {
    return request<T>(path, { method: "POST", body: JSON.stringify(body) });
  },
  patch<T>(path: string, body: unknown): Promise<T> {
    return request<T>(path, { method: "PATCH", body: JSON.stringify(body) });
  },
};
