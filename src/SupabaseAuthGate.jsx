import { cloneElement, useEffect, useState } from "react";
import { supabase } from "./supabase.js";
import racerArt from "../assets/racer-art.svg";
import "./auth.css";

function readableError(error) {
  if (!error) return "Não foi possível concluir a operação.";
  if (error.message?.includes("Invalid login credentials")) return "Email ou senha inválidos.";
  if (error.message?.includes("Email not confirmed")) return "Confirme seu email antes de entrar.";
  if (error.message?.includes("User already registered")) return "Este email já está cadastrado.";
  if (error.message?.includes("rate limit")) return "Muitas tentativas. Tente novamente mais tarde.";
  return "Não foi possível autenticar. Verifique os dados ou tente novamente.";
}

export default function SupabaseAuthGate({ children }) {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let active = true;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!active) return;
      setSession(nextSession);
      setLoading(false);
    });
    supabase.auth.getUser().then(({ error: fetchError }) => {
      if (active && fetchError && fetchError.name !== "AuthSessionMissingError") {
        setError("Não foi possível verificar sua sessão. Confirme sua conexão.");
      }
      if (active) setLoading(false);
    }).catch(() => { if (active) setLoading(false); });
    return () => { active = false; subscription.unsubscribe(); };
  }, []);

  useEffect(() => {
    if (!session?.user) return;
    const displayName = session.user.user_metadata?.name || session.user.email?.split("@")[0] || "Piloto";
    const normalized = String(displayName).trim().slice(0, 60);
    if (normalized.length < 2) return;
    void supabase.from("pares_profiles")
      .upsert({ user_id: session.user.id, display_name: normalized }, { onConflict: "user_id" })
      .then(({ error: profileError }) => {
        if (profileError) console.warn("Perfil não sincronizado:", profileError.code);
      });
  }, [session?.user?.id]);

  function switchMode(nextMode) {
    setMode(nextMode);
    setPassword("");
    setError("");
    setNotice("");
  }

  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    const normalizedEmail = email.trim().toLowerCase();
    try {
      if (mode === "register") {
        const normalizedName = name.trim();
        if (normalizedName.length < 2 || normalizedName.length > 60) throw new Error("Invalid name");
        const { data, error: signUpError } = await supabase.auth.signUp({
          email: normalizedEmail,
          password,
          options: {
            data: { name: normalizedName },
            emailRedirectTo: window.location.origin
          }
        });
        if (signUpError) throw signUpError;
        setPassword("");
        if (!data.session) {
          setNotice("Cadastro recebido. Verifique seu email e confirme a conta antes de entrar.");
        }
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: normalizedEmail, password
        });
        if (signInError) throw signInError;
        setPassword("");
      }
    } catch (err) {
      setError(err.message === "Invalid name" ? "Nome deve ter entre 2 e 60 caracteres." : readableError(err));
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    if (busy) return;
    setBusy(true);
    try {
      const { error: signOutError } = await supabase.auth.signOut();
      if (signOutError) throw signOutError;
      setError("");
    } catch (err) {
      setError(readableError(err));
    } finally { setBusy(false); }
  }

  if (session?.user) {
    const username = session.user.user_metadata?.name || session.user.email?.split("@")[0] || "Piloto";
    return (
      <>
        <div className="auth-session-bar">
          <div><span aria-hidden="true">✳</span> PILOTO CONECTADO <strong>{username}</strong></div>
          <button type="button" disabled={busy} onClick={logout}>SAIR DA CONTA ↗</button>
        </div>
        {error && <p className="auth-session-error" role="alert">{error}</p>}
        {cloneElement(children, { supabaseSession: session })}
      </>
    );
  }

  return (
    <main className="auth-page">
      <div className="auth-stripe" aria-hidden="true">PARES RACING CLUB　✳　SUPABASE AUTH　✳　MEMORY GRAND PRIX</div>
      <section className="auth-poster" aria-labelledby="auth-title">
        <a className="auth-logo" href="./">PARES<span>.</span></a>
        <div className="auth-poster-copy">
          <div className="auth-kicker">PARES RACING CLUB / ACESSO</div>
          <h1>SUA MENTE.<br /><em>SEM FREIOS.</em></h1>
          <p>Crie seu perfil de piloto ou acesse sua conta para entrar na pista da memória.</p>
          <div className="auth-poster-foot">FOCO / REFLEXO / VELOCIDADE</div>
        </div>
        <img className="auth-racer" src={racerArt} alt="" aria-hidden="true" />
      </section>
      <section className="auth-form-panel" aria-labelledby="auth-title">
        <div className="auth-overline">ÁREA DO PILOTO / 001</div>
        {loading ? <p className="auth-loading" role="status">Verificando sua sessão…</p> : (
          <>
            <h2 id="auth-title">{mode === "register" ? "ENTRE PARA O GRID." : "VOLTE À PISTA."}</h2>
            <p className="auth-intro">Entre com a conta do PARES para sincronizar seus recordes entre dispositivos.</p>
            <div className="auth-tabs" role="group" aria-label="Acesso">
              <button type="button" className={mode === "login" ? "selected" : ""} aria-pressed={mode === "login"} onClick={() => switchMode("login")}>ENTRAR</button>
              <button type="button" className={mode === "register" ? "selected" : ""} aria-pressed={mode === "register"} onClick={() => switchMode("register")}>CRIAR CONTA</button>
            </div>
            <form className="auth-form" onSubmit={submit}>
              {mode === "register" && <label htmlFor="auth-name">NOME DO PILOTO
                <input id="auth-name" type="text" autoComplete="name" required minLength={2} maxLength={60} value={name} onChange={e => setName(e.target.value)} />
              </label>}
              <label htmlFor="auth-email">EMAIL
                <input id="auth-email" type="email" autoComplete="email" required maxLength={254} value={email} onChange={e => setEmail(e.target.value)} placeholder="voce@exemplo.com" />
              </label>
              <label htmlFor="auth-password">SENHA
                <input id="auth-password" type="password" autoComplete={mode === "register" ? "new-password" : "current-password"} required minLength={10} maxLength={128} value={password} onChange={e => setPassword(e.target.value)} placeholder="Pelo menos 10 caracteres" />
              </label>
              {error && <p className="auth-error" role="alert">{error}</p>}
              {notice && <p className="auth-local-note" role="status">{notice}</p>}
              <button className="auth-submit" type="submit" disabled={busy}>{busy ? "AGUARDE…" : mode === "register" ? "CRIAR CONTA" : "ENTRAR NA PISTA"} <span aria-hidden="true">↗</span></button>
            </form>
            <p className="auth-local-note">Contas da versão antiga SQLite não são convertidas automaticamente para o Supabase. Crie uma nova conta para ativar a sincronização; o banco antigo permanece preservado.</p>
          </>
        )}
      </section>
    </main>
  );
}
