import { authHeaders, onReadTokenChange } from "../readToken";
import type { ApiErrorPayload } from "./types";

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly code: string | null = null, readonly payload: unknown = null) {
    super(message);
    this.name = "ApiError";
  }
}

export interface RequestOptions extends Omit<RequestInit, "body"> {
  body?: unknown;
  authenticated?: boolean;
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const url = path.startsWith("/api/") ? path : `/api/v1/${path.replace(/^\//, "")}`;
  const headers = new Headers(options.headers);
  headers.set("Accept", "application/json");
  if (options.body !== undefined) headers.set("Content-Type", "application/json");
  if (options.authenticated !== false) {
    for (const [key, value] of Object.entries(authHeaders())) headers.set(key, value);
  }
  let response: Response;
  try {
    response = await fetch(url, {
      ...options,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      cache: options.cache ?? "no-store",
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ApiError("Backend nicht erreichbar", 0);
  }
  if (response.status === 304) return undefined as T;
  const raw = await response.text();
  let payload: unknown = null;
  if (raw) {
    try { payload = JSON.parse(raw) as unknown; } catch { payload = raw; }
  }
  if (!response.ok) {
    const detail = payload && typeof payload === "object" ? (payload as ApiErrorPayload).detail ?? (payload as ApiErrorPayload).message : null;
    const code = payload && typeof payload === "object" ? (payload as ApiErrorPayload).error_code ?? null : null;
    throw new ApiError(typeof detail === "string" ? detail : `API-Anfrage fehlgeschlagen (${response.status})`, response.status, code, payload);
  }
  if (!raw) return undefined as T;
  return payload as T;
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) => request<T>(path, { method: "GET", signal }),
  post: <T>(path: string, body: unknown, signal?: AbortSignal) => request<T>(path, { method: "POST", body, signal }),
  put: <T>(path: string, body: unknown, signal?: AbortSignal) => request<T>(path, { method: "PUT", body, signal }),
  delete: <T>(path: string, signal?: AbortSignal) => request<T>(path, { method: "DELETE", signal }),
};

export { authHeaders, onReadTokenChange };
