import { createServer } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, scrypt as scryptCallback, createHash, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const SESSION_AGE_SECONDS = 60 * 60 * 24 * 7;
const MAX_BODY_BYTES = 16_384;
const COOKIE_NAME = "pares_session";
const DIST_DIR = resolve(process.env.STATIC_DIR || "dist");
const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".json": "application/json; charset=utf-8"
};

async function serveFrontend(req, res, pathname, distDir = DIST_DIR) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return respond(res, 405, { error: "Método não permitido." }, { Allow: "GET, HEAD" });
  }
  const fileName = pathname === "/" ? "index.html" : pathname.slice(1);
  const candidate = resolve(distDir, fileName);
  if (candidate !== distDir && !candidate.startsWith(distDir + sep)) {
    return respond(res, 404, { error: "Arquivo não encontrado." });
  }
  // Rotas do React retornam index.html; URLs de assets inexistentes retornam 404.
  const pathToRead = pathname === "/" || pathname === "/index.html" ||
    ((req.headers.accept || "").includes("text/html") && !pathname.includes("."))
    ? resolve(distDir, "index.html") : candidate;
  try {
    const data = await readFile(pathToRead);
    res.writeHead(200, {
      "Content-Type": CONTENT_TYPES[extname(pathToRead)] || "application/octet-stream",
      "Cache-Control": pathToRead.includes(sep + "assets" + sep)
        ? "public, max-age=31536000, immutable" : "no-cache",
      "X-Content-Type-Options": "nosniff"
    });
    return res.end(req.method === "HEAD" ? undefined : data);
  } catch (error) {
    if (error.code !== "ENOENT" && error.code !== "EISDIR") {
      console.error("Falha ao servir arquivo estático:", error);
      return respond(res, 500, { error: "Erro ao servir aplicação." });
    }
    return respond(res, 404, { error: "Arquivo não encontrado." });
  }
}
const originAllowlist = new Set([
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  ...(process.env.APP_ORIGIN ? process.env.APP_ORIGIN.split(",").map(s => s.trim()) : [])
]);

export function openDatabase(path = process.env.SQLITE_PATH ||
  (process.env.NODE_ENV === "production" ? "/data/pares.sqlite" : resolve("data/pares.sqlite"))) {
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

// Requests from Cloudflare use bearer tokens; the legacy SQLite cookie is never forwarded.
// Verify tokens against Supabase Auth (not decoded client-side), then use the caller's JWT
// with PostgREST RLS. No service-role credentials are needed.
async function handleSupabase(req, res, pathname, bodyReader = bodyAsJson) {
  const url = process.env.SUPABASE_URL;
  const apiKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !apiKey) return respond(res, 503, { error: "Supabase não configurado no backend." });
  if (!/^https:\/\/[a-z0-9.-]+\.supabase\.co$/.test(url)) {
    return respond(res, 503, { error: "URL de banco inválida." });
  }
  if (pathname === "/api/supabase/status" && req.method === "GET") {
    try {
      const r = await fetch(url + "/auth/v1/health", {
        headers: { apikey: apiKey }, signal: AbortSignal.timeout(5000)
      });
      return respond(res, r.ok ? 200 : 503, { ok: r.ok, provider: "supabase" });
    } catch {
      return respond(res, 503, { ok: false, provider: "supabase" });
    }
  }
  const bearer = req.headers.authorization || "";
  if (!/^Bearer [A-Za-z0-9._-]{20,4096}$/.test(bearer)) {
    return respond(res, 401, { error: "Token de acesso ausente." });
  }
  const clientHeaders = { apikey: apiKey, Authorization: bearer };
  let identity;
  try {
    const verification = await fetch(url + "/auth/v1/user", {
      headers: clientHeaders, signal: AbortSignal.timeout(5000)
    });
    if (!verification.ok) return respond(res, 401, { error: "Sessão inválida ou expirada." });
    identity = await verification.json();
    if (!identity?.id || typeof identity.id !== "string") {
      return respond(res, 401, { error: "Sessão inválida." });
    }
  } catch {
    return respond(res, 503, { error: "Serviço de autenticação indisponível." });
  }
  if (pathname === "/api/supabase/me" && req.method === "GET") {
    return respond(res, 200, { user: { id: identity.id, email: identity.email } });
  }
  if (pathname !== "/api/supabase/scores") {
    return respond(res, 404, { error: "Rota inexistente." });
  }
  if (req.method !== "GET" && req.method !== "PUT") {
    return respond(res, 405, { error: "Método não permitido." }, { Allow: "GET, PUT" });
  }
  const endpoint = url + "/rest/v1/pares_best_scores";
  const query = new URLSearchParams({ user_id: "eq." + identity.id, select: "difficulty,score,elapsed_seconds,moves" });
  const dbHeaders = { ...clientHeaders, Accept: "application/json" };
  let existing;
  try {
    const answer = await fetch(endpoint + "?" + query.toString(), {
      headers: dbHeaders, signal: AbortSignal.timeout(6000)
    });
    if (!answer.ok) return respond(res, 503, { error: "Não foi possível consultar resultados." });
    existing = await answer.json();
    if (!Array.isArray(existing)) throw new Error("Invalid scores response");
  } catch {
    return respond(res, 503, { error: "Banco de resultados indisponível." });
  }
  if (req.method === "GET") return respond(res, 200, { records: existing });

  const body = await bodyReader(req);
  const { difficulty, score, moves, elapsed_seconds: elapsed } = body;
  if (!["easy", "medium", "hard"].includes(difficulty) ||
    !Number.isInteger(score) || score < 0 || score > 1000 ||
    !Number.isInteger(moves) || moves < 1 || moves > 100000 ||
    !Number.isInteger(elapsed) || elapsed < 0 || elapsed > 86400) {
    return respond(res, 400, { error: "Resultado inválido." });
  }
  const previous = existing.find(row => row.difficulty === difficulty);
  if (previous && (previous.score > score ||
    (previous.score === score && previous.elapsed_seconds <= elapsed))) {
    return respond(res, 200, { saved: false, record: previous });
  }
  const values = {
    user_id: identity.id,
    difficulty, score, moves, elapsed_seconds: elapsed
  };
  try {
    const insertUrl = endpoint + "?on_conflict=user_id,difficulty";
    const result = await fetch(insertUrl, {
      method: "POST",
      headers: {
        ...dbHeaders,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=representation"
      },
      body: JSON.stringify(values),
      signal: AbortSignal.timeout(6000)
    });
    if (!result.ok) {
      console.error("[Supabase] write status:", result.status);
      return respond(res, 503, { error: "Não foi possível salvar o resultado." });
    }
    const rows = await result.json();
    return respond(res, 200, { saved: true, record: rows[0] });
  } catch {
    return respond(res, 503, { error: "Falha de conexão com o banco." });
  }
}

export function createAuthServer(db, { staticDir = null } = {}) {
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
      if (req.method === "GET" && (pathname === "/health" || pathname === "/api/health")) {
        // Prova que o processo está vivo e que o banco está acessível.
        db.prepare("SELECT 1 AS healthy").get();
        return respond(res, 200, { ok: true, database: "sqlite" });
      }
      if (!pathname.startsWith("/api/")) {
        return staticDir ? await serveFrontend(req, res, pathname, staticDir) :
          respond(res, 404, { error: "Rota inexistente." });
      }
      if (pathname.startsWith("/api/supabase/")) {
        if (req.method === "PUT") {
          const origin = req.headers.origin;
          if (origin && !originAllowlist.has(origin)) {
            return respond(res, 403, { error: "Origem não autorizada." });
          }
        }
        return await handleSupabase(req, res, pathname);
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
  const isProduction = process.env.NODE_ENV === "production";
  const databasePath = process.env.SQLITE_PATH ||
    (isProduction ? "/data/pares.sqlite" : resolve("data/pares.sqlite"));
  if (isProduction && !process.env.APP_ORIGIN) {
    console.error("[API] APP_ORIGIN é obrigatório em produção.");
    process.exit(1);
  }
  const db = openDatabase(databasePath);
  const port = Number(process.env.PORT || process.env.API_PORT || 3001);
  const host = isProduction ? "0.0.0.0" : "127.0.0.1";
  const server = createAuthServer(db, { staticDir: isProduction ? DIST_DIR : null });
  server.listen(port, host, () => {
    console.log(`[API] PARES ouvindo em http://${host}:${port} (${isProduction ? "produção" : "local"})`);
    console.log(`[API] SQLite: ${databasePath}`);
  });
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => server.close(() => { db.close(); process.exit(0); }));
  }
}
