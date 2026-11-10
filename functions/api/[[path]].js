// Cloudflare Pages Functions: transparent, restricted same-origin proxy to Railway.
// No secrets stored here; Supabase Auth tokens arrive via Authorization.
const RAILWAY_ORIGIN = "https://memory-production-6ff74d87.up.railway.app";
const ALLOWED_PATHS = new Set([
  "/api/health",
  "/api/supabase/me",
  "/api/supabase/scores"
]);
const METHODS = {
  "/api/health": new Set(["GET", "HEAD"]),
  "/api/supabase/me": new Set(["GET"]),
  "/api/supabase/scores": new Set(["GET", "PUT"])
};

export async function onRequest({ request }) {
  const source = new URL(request.url);
  if (!ALLOWED_PATHS.has(source.pathname) || !METHODS[source.pathname].has(request.method)) {
    return new Response(JSON.stringify({ error: "Rota inexistente." }), {
      status: 404,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
    });
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    const origin = request.headers.get("Origin");
    if (origin && origin !== source.origin) {
      return new Response(JSON.stringify({ error: "Origem não autorizada." }), {
        status: 403,
        headers: { "Content-Type": "application/json" }
      });
    }
  }

  const dest = RAILWAY_ORIGIN + source.pathname;
  const headers = new Headers();
  for (const name of ["Accept", "Content-Type", "Authorization"]) {
    const val = request.headers.get(name);
    if (val) headers.set(name, val);
  }
  // Railway validates this fixed, trusted origin rather than the Pages host.
  headers.set("Origin", RAILWAY_ORIGIN);
  const options = { method: request.method, headers, redirect: "manual" };
  if (request.method === "PUT") options.body = request.body;
  try {
    const response = await fetch(dest, options);
    const downstream = new Headers();
    downstream.set("Content-Type", response.headers.get("Content-Type") || "application/json");
    downstream.set("Cache-Control", "no-store");
    downstream.set("X-Content-Type-Options", "nosniff");
    return new Response(response.body, { status: response.status, headers: downstream });
  } catch {
    return new Response(JSON.stringify({ error: "API temporariamente indisponível." }), {
      status: 502,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
    });
  }
}
