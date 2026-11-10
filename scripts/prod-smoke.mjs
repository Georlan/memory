import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { once } from "node:events";
import { setTimeout as pause } from "node:timers/promises";

const temp = mkdtempSync(join(tmpdir(), "pares-prod-smoke-"));
const dbPath = join(temp, "users.sqlite");
const expectedOrigin = "https://pares-test.example";
const dbServer = createServer();
dbServer.listen(0, "127.0.0.1");
await once(dbServer, "listening");
const port = dbServer.address().port;
await new Promise(resolve => dbServer.close(resolve));
const base = `http://127.0.0.1:${port}`;
let processHandle;
let logs = "";

function boot() {
  logs = "";
  processHandle = spawn(process.execPath, ["server/index.mjs"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: "production",
      APP_ORIGIN: expectedOrigin,
      PORT: String(port),
      SQLITE_PATH: dbPath
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  processHandle.stdout.on("data", chunk => { logs += chunk; });
  processHandle.stderr.on("data", chunk => { logs += chunk; });
}

async function ready() {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline && processHandle.exitCode === null) {
    try {
      const response = await fetch(base + "/api/health", { signal: AbortSignal.timeout(800) });
      if (response.ok && (await response.json()).database === "sqlite") return;
    } catch { /* Starting server. */ }
    await pause(150);
  }
  throw new Error("Backend de produção não respondeu: " + logs.slice(-3000));
}

async function shutdown() {
  if (!processHandle || processHandle.exitCode !== null) return;
  const ended = once(processHandle, "exit");
  processHandle.kill("SIGTERM");
  await Promise.race([ended, pause(3_000)]);
}

try {
  assert.ok(existsSync(join(process.cwd(), "dist", "index.html")), "Execute npm run build antes do smoke de produção.");
  boot();
  await ready();

  const root = await fetch(base + "/");
  assert.equal(root.status, 200);
  assert.match(root.headers.get("content-type"), /text\/html/);
  assert.match(await root.text(), /<div id="root"><\/div>/);

  const source = await fetch(base + "/server/index.mjs");
  assert.equal(source.status, 404, "Arquivos do backend não podem ser publicados.");

  const invalidOrigin = await fetch(base + "/api/auth/register", {
    method: "POST", headers: { "Content-Type": "application/json", Origin: "https://intruso.example" },
    body: JSON.stringify({ name: "Piloto", email: "piloto@exemplo.test", password: "SenhaBemForte123!" })
  });
  assert.equal(invalidOrigin.status, 403);

  const registration = await fetch(base + "/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: expectedOrigin },
    body: JSON.stringify({ name: "Piloto", email: "piloto@exemplo.test", password: "SenhaBemForte123!" })
  });
  assert.equal(registration.status, 200, "Registro falhou: " + await registration.clone().text());
  const cookieHeader = registration.headers.get("set-cookie");
  assert.match(cookieHeader, /HttpOnly/);
  assert.match(cookieHeader, /SameSite=Strict/);
  assert.match(cookieHeader, /Secure/);
  const cookie = cookieHeader.split(";")[0];

  const loggedIn = await fetch(base + "/api/auth/me", { headers: { Cookie: cookie } });
  assert.equal(loggedIn.status, 200);
  assert.equal((await loggedIn.json()).user.name, "Piloto");

  await shutdown();
  boot();
  await ready();
  const restored = await fetch(base + "/api/auth/me", { headers: { Cookie: cookie } });
  assert.equal(restored.status, 200, "Sessão não persistiu após reinício.");
  const logout = await fetch(base + "/api/auth/logout", {
    method: "POST", headers: { Origin: expectedOrigin, Cookie: cookie }
  });
  assert.equal(logout.status, 200);
  const after = await fetch(base + "/api/auth/me", { headers: { Cookie: cookie } });
  assert.equal(after.status, 401);

  console.log("PASS: HTML, API, proteção de origem, cookies Secure, SQLite persistente e logout.");
} finally {
  await shutdown();
  rmSync(temp, { recursive: true, force: true });
}
