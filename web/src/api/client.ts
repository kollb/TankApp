import { authHeaders, onReadTokenChange } from "../readToken";
import type { ApiErrorPayload } from "./types";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null = null,
    readonly payload: unknown = null,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface RequestOptions extends Omit<RequestInit, "body"> {
  body?: unknown;
  authenticated?: boolean;
}

interface CachedResponse {
  etag: string;
  payload: unknown;
}

// Keep only the last response in memory. This enables conditional polling
// without persisting private ledger data or relying on the browser's HTTP cache.
const responseCache = new Map<string, CachedResponse>();
onReadTokenChange(() => responseCache.clear());

function cacheKey(url: string, headers: Headers): string {
  return `GET ${url} ${headers.get("Authorization") ?? ""} ${headers.get("X-TankApp-UI") ?? ""}`;
}

function parsePayload(raw: string): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const url = path.startsWith("/api/") ? path : `/api/v1/${path.replace(/^\//, "")}`;
  const method = (options.method ?? "GET").toUpperCase();
  const headers = new Headers(options.headers);
  if (!headers.has("Accept")) headers.set("Accept", "application/json");
  if (options.body !== undefined) headers.set("Content-Type", "application/json");
  if (!headers.has("X-TankApp-UI")) headers.set("X-TankApp-UI", "nas-v1");
  if (options.authenticated !== false) {
    for (const [key, value] of Object.entries(authHeaders())) headers.set(key, value);
  }

  const key = method === "GET" ? cacheKey(url, headers) : null;
  const cached = key ? responseCache.get(key) : undefined;
  if (cached?.etag && !headers.has("If-None-Match")) {
    headers.set("If-None-Match", cached.etag);
  }

  const { authenticated: _authenticated, body, ...init } = options;
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: options.cache ?? "no-store",
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ApiError("Backend nicht erreichbar", 0);
  }

  if (response.status === 304) {
    if (!cached) {
      throw new ApiError("Die bestätigten Daten sind nicht mehr im Speicher", 304, "cache_miss");
    }
    const etag = response.headers.get("ETag") ?? cached.etag;
    if (key) responseCache.set(key, { ...cached, etag });
    return cached.payload as T;
  }

  const raw = await response.text();
  const payload = parsePayload(raw);
  if (!response.ok) {
    const detail = payload && typeof payload === "object"
      ? (payload as ApiErrorPayload).detail ?? (payload as ApiErrorPayload).message
      : null;
    const code = payload && typeof payload === "object"
      ? (payload as ApiErrorPayload).error_code ?? null
      : null;
    throw new ApiError(
      typeof detail === "string" ? detail : `API-Anfrage fehlgeschlagen (${response.status})`,
      response.status,
      code,
      payload,
    );
  }

  if (key) {
    const etag = response.headers.get("ETag");
    if (etag && raw) responseCache.set(key, { etag, payload });
    else responseCache.delete(key);
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
