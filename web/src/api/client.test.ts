import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, request } from "./client";
import { setReadToken } from "../readToken";

const fetchMock = vi.fn<typeof fetch>();

function jsonResponse(body: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...Object.fromEntries(new Headers(headers)) },
  });
}

describe("API client", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    setReadToken(null);
  });

  afterEach(() => {
    setReadToken(null);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("adds JSON request headers and parses a success payload", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(api.get<{ ok: boolean }>("health")).resolves.toEqual({ ok: true });
    const [, init] = fetchMock.mock.calls[0];
    expect(new Headers(init?.headers).get("Accept")).toBe("application/json");
    expect(new Headers(init?.headers).get("X-TankApp-UI")).toBe("nas-v1");
    expect(String(fetchMock.mock.calls[0][0])).toContain("/api/v1/health");
  });

  it("caches ETags per request URL, sends If-None-Match, and reuses the body on 304", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ sequence: 1 }, 200, { ETag: '"v1"' }));
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 304 }));
    vi.stubGlobal("fetch", fetchMock);
    const first = await api.get("overview?fuel=e10");
    const second = await api.get("overview?fuel=e10");
    expect(first).toEqual({ sequence: 1 });
    expect(second).toEqual(first);
    expect(new Headers(fetchMock.mock.calls[1][1]?.headers).get("If-None-Match")).toBe('"v1"');
  });

  it("keeps ETag bodies separate for each TankApp UI contract", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ contract: "pi" }, 200, { ETag: '"pi"' }));
    fetchMock.mockResolvedValueOnce(jsonResponse({ contract: "nas" }, 200, { ETag: '"nas"' }));
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 304 }));
    vi.stubGlobal("fetch", fetchMock);

    await request("contract-cache", { headers: { "X-TankApp-UI": "pi-v1" } });
    await api.get("contract-cache");
    expect(new Headers(fetchMock.mock.calls[1][1]?.headers).get("If-None-Match")).toBeNull();
    await expect(request("contract-cache", { headers: { "X-TankApp-UI": "pi-v1" } }))
      .resolves.toEqual({ contract: "pi" });
    expect(new Headers(fetchMock.mock.calls[2][1]?.headers).get("If-None-Match")).toBe('"pi"');
  });

  it("invalidates cached bodies when the read token changes", async () => {
    setReadToken("token-a");
    fetchMock.mockResolvedValueOnce(jsonResponse({ token: "a" }, 200, { ETag: '"a"' }));
    fetchMock.mockResolvedValueOnce(jsonResponse({ token: "b" }, 200, { ETag: '"b"' }));
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 304 }));
    vi.stubGlobal("fetch", fetchMock);

    await api.get("profiles");
    setReadToken("token-b");
    await api.get("profiles");
    const secondRequestHeaders = new Headers(fetchMock.mock.calls[1][1]?.headers);
    expect(secondRequestHeaders.get("Authorization")).toBe("Bearer token-b");
    expect(secondRequestHeaders.get("If-None-Match")).toBeNull();

    await expect(api.get("profiles")).resolves.toEqual({ token: "b" });
    expect(new Headers(fetchMock.mock.calls[2][1]?.headers).get("If-None-Match")).toBe('"b"');
  });

  it("preserves HTTP status and raw response text for a non-JSON error", async () => {
    fetchMock.mockResolvedValueOnce(new Response("upstream unavailable", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);
    const error = await api.get("health").catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 503,
      payload: "upstream unavailable",
      message: "API-Anfrage fehlgeschlagen (503)",
    });
  });
});
