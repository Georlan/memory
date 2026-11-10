import test from "node:test";
import assert from "node:assert/strict";
import { onRequest } from "../functions/api/[[path]].js";

test("Cloudflare Pages Function forwards only allowed API routes to Railway", async () => {
  const originalFetch = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (destination, options) => {
    seen.push({ destination, options });
    return Response.json({ ok: true }, { status: 200 });
  };
  try {
    const token = "Bearer " + "a".repeat(64);
    let response = await onRequest({
      request: new Request("https://pares.pages.dev/api/supabase/me", {
        headers: { Authorization: token }
      })
    });
    assert.equal(response.status, 200);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].destination, "https://memory-production-6ff74d87.up.railway.app/api/supabase/me");
    assert.equal(seen[0].options.headers.get("Authorization"), token);

    response = await onRequest({
      request: new Request("https://pares.pages.dev/api/auth/register", { method: "GET" })
    });
    assert.equal(response.status, 404);
    assert.equal(seen.length, 1);

    response = await onRequest({
      request: new Request("https://pares.pages.dev/api/supabase/scores", {
        method: "PUT",
        headers: { Origin: "https://outsider.example" },
        body: JSON.stringify({ difficulty: "easy" })
      })
    });
    assert.equal(response.status, 403);
    assert.equal(seen.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
