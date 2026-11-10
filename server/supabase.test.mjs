import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createAuthServer, openDatabase } from "./index.mjs";

test("Railway verifies Supabase bearer and uses per-user RLS for scores", async () => {
  const originalFetch = globalThis.fetch;
  const oldUrl = process.env.SUPABASE_URL;
  const oldKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test_only";
  const db = openDatabase(":memory:");
  const server = createAuthServer(db);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = "http://127.0.0.1:" + server.address().port;
  const token = "a".repeat(64);
  const requests = [];
  globalThis.fetch = async (url, options = {}) => {
    const path = new URL(url).pathname;
    requests.push({ url, options, path });
    if (path === "/auth/v1/health") return Response.json({ status: "ok" });
    if (path === "/auth/v1/user") {
      return options.headers.Authorization === "Bearer " + token
        ? Response.json({ id: "4d748d56-1e5b-4bd7-96c3-85353d76e234", email: "piloto@example.test" })
        : Response.json({ message: "invalid" }, { status: 401 });
    }
    if (path === "/rest/v1/pares_best_scores") {
      if (options.method === "POST") return Response.json([JSON.parse(options.body)]);
      return Response.json([]);
    }
    return Response.json({}, { status: 404 });
  };

  // Use originalFetch to reach our own local server. Supabase upstream is mocked.
  const call = (path, options) => originalFetch(base + path, options);
  try {
    let response = await call("/api/supabase/status");
    assert.equal(response.status, 200);
    response = await call("/api/supabase/me");
    assert.equal(response.status, 401);
    response = await call("/api/supabase/me", { headers: { Authorization: "Bearer " + token } });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).user.email, "piloto@example.test");

    response = await call("/api/supabase/scores", { headers: { Authorization: "Bearer " + token } });
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).records, []);

    response = await call("/api/supabase/scores", {
      method: "PUT",
      headers: {
        Authorization: "Bearer " + token,
        Origin: "https://hacker.example",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ difficulty: "easy", score: 600, moves: 6, elapsed_seconds: 30 })
    });
    assert.equal(response.status, 403);

    response = await call("/api/supabase/scores", {
      method: "PUT",
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify({ difficulty: "hard", score: 99999, moves: 1, elapsed_seconds: 4 })
    });
    assert.equal(response.status, 400);

    response = await call("/api/supabase/scores", {
      method: "PUT",
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify({ difficulty: "easy", score: 600, moves: 6, elapsed_seconds: 30 })
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).saved, true);
    const write = requests.find(r => r.options.method === "POST");
    assert.equal(new URL(write.url).hostname, "example.supabase.co");
    assert.equal(write.options.headers.Authorization, "Bearer " + token);
    assert.equal(JSON.parse(write.options.body).user_id, "4d748d56-1e5b-4bd7-96c3-85353d76e234");
    assert.ok(!JSON.stringify(write).includes("service_role"));
  } finally {
    globalThis.fetch = originalFetch;
    await new Promise(resolve => server.close(resolve));
    db.close();
    if (oldUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = oldUrl;
    if (oldKey === undefined) delete process.env.SUPABASE_PUBLISHABLE_KEY;
    else process.env.SUPABASE_PUBLISHABLE_KEY = oldKey;
  }
});
