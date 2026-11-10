import { useEffect, useState } from "react";
import "./auth.css";

const ENABLED = import.meta.env.VITE_AUTH_ENABLED === "true" ||
  (import.meta.env.DEV && import.meta.env.VITE_AUTH_ENABLED !== "false");

async function apiRequest(path, payload, signal) {
  let response;
  try {
    response = await fetch(path, {
      method: payload ? "POST" : "GET",
      headers: payload ? { "Content-Type": "application/json" } : {},
      credentials: "same-origin",
      signal,
      ...(payload ? { body: JSON.stringify(payload) } : {})
    });
  } catch (error) {
    if (error.name === "AbortError") throw error;
    throw new Error("API local indisponível. Execute npm run dev para iniciar React e SQLite.");
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || "Não foi possível completar a solicitação.");
    error.status = response.status;
    throw error;
  }
  return data;
}

export default function AuthGate({ children }) {
  const [status, setStatus] = useState("loading");
  const [user, setUser] = useState(null);
  const [mode, setMode] = useState("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!ENABLED) return;
    const controller = new AbortController();
    apiRequest("/api/auth/me", null, controller.signal)
      .then(data => { setUser(data.user); setStatus("ready"); })
      .catch(err => {
        if (err.name === "AbortError") return;
        setStatus("ready");
        if (err.status !== 401) setError(err.message);
      });
    return () => controller.abort();
  }, []);

  if (!ENABLED) return children;

  function changeMode(next) {
    setMode(next);
    setError("");
    setPassword("");
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const endpoint = mode === "register" ? "/api/auth/register" : "/api/auth/login";
      const result = await apiRequest(endpoint, {
        ...(mode === "register" ? { name: name.trim() } : {}),
        email: email.trim(),
        password
      });
      setPassword("");
      setUser(result.user);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    setBusy(true);
    setError("");
    try {
      await apiRequest("/api/auth/logout", {});
      setUser(null);
      setPassword("");
    } catch (err) {
      setError("Não foi possível encerrar a sessão. " + err.message);
    } finally {
      setBusy(false);
    }
  }

  if (user) return (
    <>
      <div className="auth-session-bar" role="status">
        <div><span aria-hidden="true">✳</span> PILOTO CONECTADO <strong>{user.name}</strong></div>
        <button type="button" onClick={logout} disabled={busy}>SAIR DA CONTA ↗</button>
      </div>
      {error && <p className="auth-session-error" role="alert">{error}</p>}
      {children}
    </>
  );

  return (
    <main className="auth-page">
      <div className="auth-stripe" aria-hidden="true">PARES RACING CLUB　✳　AUTENTICAÇÃO LOCAL　✳　MEMORY GRAND PRIX</div>
      <section className="auth-poster" aria-labelledby="auth-title">
        <a className="auth-logo" href="./">PARES<span>.</span></a>
        <div className="auth-poster-copy">
          <div className="auth-kicker">EDIÇÃO DE TESTE / SQLITE LOCAL</div>
          <h1>SUA MENTE.<br /><em>SEM FREIOS.</em></h1>
          <p>Crie seu perfil de piloto ou acesse sua conta para entrar na pista da memória.</p>
          <div className="auth-poster-foot">FOCO / REFLEXO / VELOCIDADE</div>
        </div>
        <img className="auth-racer" src="/assets/racer-art.svg" alt="" aria-hidden="true" />
      </section>
      <section className="auth-form-panel" aria-labelledby="auth-title">
        <div className="auth-overline">ÁREA DO PILOTO / 001</div>
        {status === "loading" ? (
          <p className="auth-loading" role="status">Verificando sua sessão…</p>
        ) : (
          <>
            <h2 id="auth-title">{mode === "register" ? "ENTRE PARA O GRID." : "VOLTE À PISTA."}</h2>
            <p className="auth-intro">{mode === "register"
              ? "Cadastre seu perfil no banco SQLite deste computador."
              : "Entre com seu email e senha para continuar sua corrida."}</p>
            <div className="auth-tabs" role="group" aria-label="Acesso">
              <button type="button" className={mode === "login" ? "selected" : ""} aria-pressed={mode === "login"} onClick={() => changeMode("login")}>ENTRAR</button>
              <button type="button" className={mode === "register" ? "selected" : ""} aria-pressed={mode === "register"} onClick={() => changeMode("register")}>CRIAR CONTA</button>
            </div>
            <form onSubmit={handleSubmit} className="auth-form">
              {mode === "register" && (
                <label htmlFor="auth-name">NOME DO PILOTO
                  <input id="auth-name" name="name" autoComplete="name" value={name} onChange={event => setName(event.target.value)} minLength={2} maxLength={60} required placeholder="Como podemos chamar você?" />
                </label>
              )}
              <label htmlFor="auth-email">EMAIL
                <input id="auth-email" name="email" type="email" autoComplete="email" maxLength={254} value={email} onChange={event => setEmail(event.target.value)} required placeholder="voce@exemplo.com" />
              </label>
              <label htmlFor="auth-password">SENHA
                <input id="auth-password" name="password" type="password" autoComplete={mode === "register" ? "new-password" : "current-password"} minLength={10} maxLength={128} value={password} onChange={event => setPassword(event.target.value)} required placeholder="Pelo menos 10 caracteres" />
              </label>
              {error && <p className="auth-error" role="alert">{error}</p>}
              <button className="auth-submit" type="submit" disabled={busy}>
                {busy ? "AGUARDE…" : mode === "register" ? "CRIAR CONTA" : "ENTRAR NA PISTA"} <span aria-hidden="true">↗</span>
              </button>
            </form>
            <p className="auth-local-note">Seus dados ficam apenas no SQLite local. Senhas são armazenadas com hash scrypt; o navegador recebe um cookie de sessão HttpOnly. Recordes do jogo ainda são locais ao navegador.</p>
          </>
        )}
      </section>
    </main>
  );
}
