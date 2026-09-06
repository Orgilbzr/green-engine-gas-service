const PRODUCTION_ORIGIN = "https://gas.ecoauto.app";

export function checkRequestOrigin(request: Request): Response | null {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) return null;
  try {
    const origin = request.headers.get("origin");
    const referer = request.headers.get("referer");
    // An explicitly invalid Origin must never be rescued by a valid Referer.
    const value = origin !== null ? origin : referer;
    if (!value || value === "null") throw new Error();
    const url = new URL(value);
    if (url.username || url.password || !["http:", "https:"].includes(url.protocol)) throw new Error();
    if (origin !== null && (url.pathname !== "/" || url.search || url.hash || value !== url.origin)) throw new Error();
    const allowed = url.origin === PRODUCTION_ORIGIN || (
      process.env.NODE_ENV !== "production" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) &&
      url.origin === new URL(request.url).origin
    );
    if (allowed) return null;
  } catch { /* Reject without logging request headers or origin values. */ }
  return Response.json({ error: "Хүсэлтийг зөвшөөрөх боломжгүй байна." }, { status: 403, headers: { "Cache-Control": "no-store" } });
}
