import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { createAuthServer, openDatabase } from "./index.mjs";

async function listen(db) {
  const server = createAuthServer(db);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return {
    server,
    base: `http://127.0.0.1:${server.address().port}`
  };
}

async function close(server) {
  await new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
    server.closeAllConnections();
  });
}

test("API real com SQLite: registro, login, sessão, logout, validação e persistência", async () => {
  const directory = mkdtempSync(join(tmpdir(), "pares-auth-"));
  const file = join(directory, "auth.sqlite");
  let db = openDatabase(file);
  let { server, base } = await listen(db);
  let isOpen = true;
  const post = (path, body, headers = {}) => fetch(base + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body)
  });

  try {
    const health = await fetch(base + "/api/health");
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { ok: true, database: "sqlite" });

    const unauthenticated = await fetch(base + "/api/auth/me");
    assert.equal(unauthenticated.status, 401);

    const invalid = await post("/api/auth/register", {
      name: "A", email: "invalido", password: "curta"
    });
    assert.equal(invalid.status, 400);

    const registration = await post("/api/auth/register", {
      name: "Piloto Teste", email: "PILOTO@EXEMPLO.COM", password: "SenhaDeTesteMuitoForte123!"
    });
    assert.equal(registration.status, 200);
    const registered = await registration.json();
    assert.deepEqual(registered.user, { id: 1, name: "Piloto Teste", email: "piloto@exemplo.com" });
    assert.equal("password_hash" in registered.user, false);

    const cookieHeader = registration.headers.get("set-cookie");
    assert.match(cookieHeader, /HttpOnly/);
    assert.match(cookieHeader, /SameSite=Strict/);
    const cookie = cookieHeader.split(";")[0];
    assert.match(cookie, /^pares_session=[a-f0-9]{64}$/);

    const stored = db.prepare("SELECT password_hash, password_salt FROM users WHERE email = ?").get("piloto@exemplo.com");
    assert.notEqual(stored.password_hash, "SenhaDeTesteMuitoForte123!");
    assert.equal(stored.password_hash.length, 128);
    assert.equal(stored.password_salt.length, 32);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM sessions").get().count, 1);

    const me = await fetch(base + "/api/auth/me", { headers: { Cookie: cookie } });
    assert.equal(me.status, 200);
    assert.equal((await me.json()).user.name, "Piloto Teste");

    const wrong = await post("/api/auth/login", { email: "piloto@exemplo.com", password: "SenhaIncorreta123" });
    assert.equal(wrong.status, 401);
    assert.equal((await wrong.json()).error, "Email ou senha incorretos.");

    const duplicate = await post("/api/auth/register", {
      name: "Outro nome", email: "piloto@exemplo.com", password: "SenhaOutraMuitoForte456"
    });
    assert.equal(duplicate.status, 409);

    const badOrigin = await post("/api/auth/login", {
      email: "piloto@exemplo.com", password: "SenhaDeTesteMuitoForte123!"
    }, { Origin: "https://site-malicioso.example" });
    assert.equal(badOrigin.status, 403);

    const login = await post("/api/auth/login", {
      email: "PILOTO@EXEMPLO.COM", password: "SenhaDeTesteMuitoForte123!"
    }, { Origin: "http://localhost:5173" });
    assert.equal(login.status, 200);
    const loginCookie = login.headers.get("set-cookie").split(";")[0];

    // Fecha a API e reabre o mesmo banco para provar persistência real em disco.
    await close(server);
    isOpen = false;
    db.close();
    db = openDatabase(file);
    ({ server, base } = await listen(db));
    isOpen = true;

    const persistent = await fetch(base + "/api/auth/me", { headers: { Cookie: loginCookie } });
    assert.equal(persistent.status, 200);
    assert.equal((await persistent.json()).user.email, "piloto@exemplo.com");

    const logout = await post("/api/auth/logout", {}, { Cookie: loginCookie });
    assert.equal(logout.status, 200);
    assert.match(logout.headers.get("set-cookie"), /Max-Age=0/);
    const afterLogout = await fetch(base + "/api/auth/me", { headers: { Cookie: loginCookie } });
    assert.equal(afterLogout.status, 401);

    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM users").get().count, 1);
  } finally {
    if (isOpen) await close(server);
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
