import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const processes = [
  spawn(process.execPath, ["server/index.mjs"], { cwd: root, stdio: "inherit" }),
  spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1"], { cwd: root, stdio: "inherit" })
];

let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of processes) if (child.exitCode === null) child.kill("SIGTERM");
  const timeout = setTimeout(() => process.exit(code), 3000);
  timeout.unref();
  Promise.all(processes.map(child => new Promise(resolveDone => {
    if (child.exitCode !== null || child.signalCode !== null) resolveDone();
    else child.once("exit", resolveDone);
  }))).then(() => process.exit(code));
}

for (const child of processes) {
  child.on("error", error => {
    console.error("Não foi possível iniciar o ambiente local:", error.message);
    stop(1);
  });
  child.on("exit", code => {
    if (!stopping) {
      console.error("Um dos servidores parou. Encerrando o ambiente local.");
      stop(code || 1);
    }
  });
}
process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
