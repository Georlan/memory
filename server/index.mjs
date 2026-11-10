import { createServer } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, scrypt as scryptCallback, createHash, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const SESSION_AGE_SECONDS = 60 * 60 * 24 * 7;
const MAX_BODY_BYTES = 16_384;
const COOKIE_NAME = "pares_session";
const originAllowlist = new Set([
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  ...(process.env.APP_ORIGIN ? process.env.APP_ORIGIN.split(",").map(s => s.trim()) : [])
]);

export function openDatabase(path = process.env.SQLITE_PATH || resolve("data/pares.sqlite")) {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 3000;
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);
  `);
  db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(Date.now());
  return db;
}

async function derivePassword(password, salt) {
  return (await scrypt(password, Buffer.from(salt, "hex"), 64)).toString("hex");
}

function tokenDigest(token) {
  return createHash("sha256").update(token).digest("hex");
}

function respond(res, status, payload, headers = {}) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...headers
  });
  res.end(JSON.stringify(payload));
}

function sessionCookie(token, maxAge) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${COOKIE_NAME}=${token}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=${maxAge}${secure}`;
}

function readCookie(header) {
  for (const part of (header || "").split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === COOKIE_NAME) {
      const token = value.join("=");
      return /^[a-f0-9]{64}$/.test(token) ? token : null;
    }
  }
  return null;
}

function safeUser(user) {
  return { id: user.id, name: user.name, email: user.email };
}

async function bodyAsJson(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      const error = new Error("Requisição muito grande.");
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  try {
    const data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (data && typeof data === "object" && !Array.isArray(data)) return data;
  } catch { /* conteúdo inválido */ }
  const error = new Error("Envie um JSON válido.");
  error.status = 400;
  throw error;
}

function validUserInput(data, needsName) {
  const email = typeof data.email === "string" ? data.email.trim().toLowerCase() : "";
  const name = typeof data.name === "string" ? data.name.trim() : "";
  const password = data.password;
  if (needsName && (name.length < 2 || name.length > 60 || /[\x00-\x1f\x7f]/.test(name))) {
    return { error: "O nome deve ter entre 2 e 60 caracteres." };
  }
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { error: "Informe um email válido." };
  }
  if (typeof password !== "string" || password.length < 10 || password.length > 128) {
    return { error: "A senha deve ter entre 10 e 128 caracteres." };
  }
  return { email, name, password };
}

export function createAuthServer(db) {
  // Limite leve para desenvolvimento local; em produção usar proteção distribuída.
  const attempts = new Map();
  function rateLimited(req, route) {
    const ip = req.socket.remoteAddress || "unknown";
    const key = route + ":" + ip;
    const now = Date.now();
    if (attempts.size > 2000) {
      for (const [k, v] of attempts) if (v.reset <= now) attempts.delete(k);
    }
    const current = attempts.get(key);
    const value = !current || current.reset <= now
      ? { count: 1, reset: now + 10 * 60_000 }
      : { count: current.count + 1, reset: current.reset };
    attempts.set(key, value);
    return value.count > 20;
  }

  function createSession(res, user) {
    const token = randomBytes(32).toString("hex");
    const now = Date.now();
    db.prepare("INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)")
      .run(tokenDigest(token), user.id, now + SESSION_AGE_SECONDS * 1000, now);
    respond(res, 200, { user: safeUser(user) }, { "Set-Cookie": sessionCookie(token, SESSION_AGE_SECONDS) });
  }

  return createServer(async (req, res) => {
    try {
      const pathname = new URL(req.url, "http://localhost").pathname;
      if (!pathname.startsWith("/api/")) return respond(res, 404, { error: "Rota inexistente." });
      if (req.method === "GET" && pathname === "/api/health") {
        return respond(res, 200, { ok: true, database: "sqlite" });
      }
      if (req.method === "GET" && pathname === "/api/auth/me") {
        const token = readCookie(req.headers.cookie);
        const user = token && db.prepare(`
          SELECT users.id, users.name, users.email
          FROM sessions JOIN users ON users.id = sessions.user_id
          WHERE sessions.token_hash = ? AND sessions.expires_at > ?
        `).get(tokenDigest(token), Date.now());
        return user ? respond(res, 200, { user: safeUser(user) }) :
          respond(res, 401, { error: "Não autenticado." });
      }
      if (req.method !== "POST" || !["/api/auth/register", "/api/auth/login", "/api/auth/logout"].includes(pathname)) {
        return respond(res, 404, { error: "Rota inexistente." });
      }
      // Sem CORS: o navegador usa /api via proxy Vite, mesma origem.
      if (req.headers.origin && !originAllowlist.has(req.headers.origin)) {
        return respond(res, 403, { error: "Origem não autorizada." });
      }
      if (pathname === "/api/auth/logout") {
        const token = readCookie(req.headers.cookie);
        if (token) db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenDigest(token));
        return respond(res, 200, { success: true }, { "Set-Cookie": sessionCookie("", 0) });
      }
      if (rateLimited(req, pathname)) return respond(res, 429, { error: "Muitas tentativas. Aguarde alguns minutos." });

      const data = await bodyAsJson(req);
      const result = validUserInput(data, pathname.endsWith("register"));
      if (result.error) return respond(res, 400, { error: result.error });
      const { email, name, password } = result;

      if (pathname === "/api/auth/register") {
        if (db.prepare("SELECT id FROM users WHERE email = ?").get(email)) {
          return respond(res, 409, { error: "Este email já está cadastrado." });
        }
        const salt = randomBytes(16).toString("hex");
        const hashed = await derivePassword(password, salt);
        let id;
        try {
          id = Number(db.prepare(`
            INSERT INTO users (name, email, password_hash, password_salt, created_at)
            VALUES (?, ?, ?, ?, ?)
          `).run(name, email, hashed, salt, Date.now()).lastInsertRowid);
        } catch (error) {
          if (String(error.message).includes("UNIQUE")) {
            return respond(res, 409, { error: "Este email já está cadastrado." });
          }
          throw error;
        }
        return createSession(res, { id, name, email });
      }

      const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
      // Deriva mesmo quando o email não existe, evitando resposta imediata.
      const fallbackSalt = "00".repeat(16);
      const derived = await derivePassword(password, user?.password_salt || fallbackSalt);
      const expected = Buffer.from(user?.password_hash || "00".repeat(64), "hex");
      if (!user || !timingSafeEqual(Buffer.from(derived, "hex"), expected)) {
        return respond(res, 401, { error: "Email ou senha incorretos." });
      }
      return createSession(res, user);
    } catch (error) {
      if (error.status) return respond(res, error.status, { error: error.message });
      console.error("Erro interno na API de autenticação:", error);
      return respond(res, 500, { error: "Erro interno do servidor." });
    }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const db = openDatabase();
  const port = Number(process.env.API_PORT || 3001);
  const server = createAuthServer(db);
  server.listen(port, "127.0.0.1", () => {
    console.log(`[API] SQLite local ativo em http://127.0.0.1:${port}`);
    console.log(`[API] Banco: ${process.env.SQLITE_PATH || resolve("data/pares.sqlite")}`);
  });
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => server.close(() => { db.close(); process.exit(0); }));
  }
}
