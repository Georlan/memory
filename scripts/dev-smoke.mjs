import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as pause } from "node:timers/promises";

const directory = mkdtempSync(join(tmpdir(), "pares-dev-smoke-"));
const child = spawn(process.execPath, ["scripts/dev.mjs"], {
  cwd: process.cwd(),
  env: { ...process.env, SQLITE_PATH: join(directory, "test.sqlite") },
  stdio: ["ignore", "pipe", "pipe"]
});
let output = "";
child.stdout.on("data", chunk => { output += chunk; });
child.stderr.on("data", chunk => { output += chunk; });
let exited = false;
child.on("exit", () => { exited = true; });

try {
  let ready = false;
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline && !exited) {
    try {
      const response = await fetch("http://127.0.0.1:5173/api/health", {
        signal: AbortSignal.timeout(900)
      });
      const data = await response.json();
      if (response.ok && data.ok === true && data.database === "sqlite") {
        ready = true;
        break;
      }
    } catch { /* Servidores iniciando. */ }
    await pause(250);
  }
  assert.ok(ready, "Vite e API não ficaram prontos. Logs: " + output.slice(-2000));
  const page = await fetch("http://127.0.0.1:5173/");
  assert.equal(page.status, 200);
  assert.match(await page.text(), /src\/main\.jsx/);
  const module = await fetch("http://127.0.0.1:5173/src/AuthGate.jsx");
  assert.equal(module.status, 200);
  console.log("PASS: npm run dev iniciou React, transformou JSX e conectou /api ao SQLite.");
} finally {
  child.kill("SIGTERM");
  await Promise.race([
    new Promise(resolve => child.once("exit", resolve)),
    pause(3500)
  ]);
  rmSync(directory, { recursive: true, force: true });
}
