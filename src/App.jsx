import React, { useEffect, useMemo, useReducer, useRef, useState } from "react";
import racerArt from "../assets/racer-art.svg";
import "../styles.css";

const ITEMS = [
  { id: "formula", icon: "🏎️", name: "carro de corrida", color: "#d81c31" },
  { id: "finish", icon: "🏁", name: "bandeira quadriculada", color: "#1e293a" },
  { id: "cup", icon: "🏆", name: "troféu", color: "#d19d3d" },
  { id: "bolt", icon: "⚡", name: "raio", color: "#e7a32d" },
  { id: "lights", icon: "🚦", name: "semáforo", color: "#a4222f" },
  { id: "tools", icon: "🔧", name: "ferramenta", color: "#3c5067" },
  { id: "fire", icon: "🔥", name: "chama", color: "#dd3f29" },
  { id: "wheel", icon: "🛞", name: "pneu", color: "#293545" },
  { id: "fuel", icon: "⛽", name: "combustível", color: "#b72a32" },
  { id: "glove", icon: "🧤", name: "luva", color: "#df6c40" }
];

const LEVEL_PAIRS = { easy: 6, medium: 8, hard: 10 };
const RECORDS_KEY = "pares-records-v1";
const SOUND_KEY = "pares-sound-v1";

function shuffle(items) {
  const list = [...items];
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

function createGame(level) {
  const selected = shuffle(ITEMS).slice(0, LEVEL_PAIRS[level]);
  const cards = shuffle(selected.flatMap(item => [
    { ...item, key: item.id + "-1" },
    { ...item, key: item.id + "-2" }
  ]));
  return {
    level, cards, selected: [], matched: [], moves: 0, mistakes: 0,
    startedAt: null, elapsed: 0, status: "ready",
    message: "Vire duas cartas para começar a jogar."
  };
}

function gameReducer(game, action) {
  if (action.type === "RESTART") return createGame(action.level);
  if (action.type === "TICK") {
    if (game.startedAt === null || game.status === "won") return game;
    const elapsed = Math.floor((action.now - game.startedAt) / 1000);
    return elapsed === game.elapsed ? game : { ...game, elapsed };
  }
  if (action.type === "HIDE") {
    if (game.selected.length !== 2 || game.status === "won") return game;
    return { ...game, selected: [], message: "Pista livre! Escolha suas próximas duas cartas." };
  }
  if (action.type !== "FLIP") return game;
  const { index, now } = action;
  if (game.status === "won" || game.selected.length === 2 || game.selected.includes(index) ||
      !game.cards[index] || game.matched.includes(game.cards[index].id)) return game;

  const startedAt = game.startedAt ?? now;
  const selected = [...game.selected, index];
  if (selected.length === 1) {
    return { ...game, selected, startedAt, status: "playing",
      message: "Primeira curva! Encontre a outra carta do par." };
  }
  const elapsed = Math.floor((now - startedAt) / 1000);
  const moves = game.moves + 1;
  if (game.cards[selected[0]].id === game.cards[selected[1]].id) {
    const matched = [...game.matched, game.cards[index].id];
    const won = matched.length === LEVEL_PAIRS[game.level];
    return { ...game, selected: [], matched, startedAt, elapsed, moves,
      status: won ? "won" : "playing",
      message: won ? "Bandeira quadriculada! Você concluiu a corrida." :
        "Ultrapassagem perfeita! Mais um par na conta." };
  }
  return { ...game, startedAt, elapsed, selected, moves, mistakes: game.mistakes + 1,
    status: "playing", message: "Derrapou! Memorize as posições e tente novamente." };
}

function readRecords() {
  try {
    const value = JSON.parse(localStorage.getItem(RECORDS_KEY) || "{}");
    if (value && typeof value === "object" && !Array.isArray(value)) return value;
  } catch { /* Navegação privada ou dados inválidos. */ }
  return {};
}

function formatTime(seconds) {
  const minutes = Math.floor(seconds / 60);
  return String(minutes).padStart(2, "0") + ":" +
    String(seconds % 60).padStart(2, "0");
}

const confettiPieces = Array.from({ length: 35 }, (_, i) => ({
  left: ((i * 37 + 13) % 100) + "%",
  "--confetti-color": ["#db1c31", "#131b2b", "#e0ac35", "#f8deb4", "#a0a6b7"][i % 5],
  "--fall-duration": (1.7 + (i % 7) * .19) + "s",
  "--fall-delay": ((i * 11) % 9) / 10 + "s",
  "--fall-angle": (i * 77) + "deg"
}));

export default function App() {
  const [game, dispatch] = useReducer(gameReducer, "easy", createGame);
  const [records, setRecords] = useState(readRecords);
  const [isNewRecord, setIsNewRecord] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(() => {
    try { return localStorage.getItem(SOUND_KEY) === "on"; }
    catch { return false; }
  });
  const audioContextRef = useRef(null);
  const dialogRef = useRef(null);
  const progress = Math.round(game.matched.length / LEVEL_PAIRS[game.level] * 100);
  const score = Math.max(0, game.matched.length * 100 - game.mistakes * 15 -
    Math.floor(game.elapsed / 10) * 5);
  const bestRecord = records[game.level];

  const playSound = (type) => {
    if (!soundEnabled) return;
    try {
      const AudioContextType = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextType) return;
      if (!audioContextRef.current) audioContextRef.current = new AudioContextType();
      const audio = audioContextRef.current;
      if (audio.state === "suspended") void audio.resume();
      const notes = { flip: [420], match: [570, 780], miss: [260], win: [520, 680, 880] }[type] || [];
      notes.forEach((frequency, i) => {
        const osc = audio.createOscillator();
        const volume = audio.createGain();
        const time = audio.currentTime + i * 0.09;
        osc.type = "sine";
        osc.frequency.setValueAtTime(frequency, time);
        volume.gain.setValueAtTime(0.0001, time);
        volume.gain.exponentialRampToValueAtTime(0.09, time + 0.012);
        volume.gain.exponentialRampToValueAtTime(0.0001, time + 0.11);
        osc.connect(volume);
        volume.connect(audio.destination);
        osc.start(time);
        osc.stop(time + 0.12);
      });
    } catch { /* Áudio não pode impedir o funcionamento da partida. */ }
  };

  useEffect(() => {
    if (game.startedAt === null || game.status === "won") return undefined;
    const interval = window.setInterval(() => dispatch({ type: "TICK", now: Date.now() }), 250);
    return () => window.clearInterval(interval);
  }, [game.startedAt, game.status]);

  useEffect(() => {
    if (game.selected.length !== 2) return undefined;
    const timeout = window.setTimeout(() => dispatch({ type: "HIDE" }), 950);
    return () => window.clearTimeout(timeout);
  }, [game.selected]);

  useEffect(() => {
    if (game.status !== "won") return undefined;
    const previous = readRecords();
    const existing = previous[game.level];
    const improved = !existing || score > existing.score ||
      (score === existing.score && game.elapsed < existing.elapsed);
    setIsNewRecord(improved);
    if (improved) {
      const next = { ...previous, [game.level]: { score, elapsed: game.elapsed, moves: game.moves } };
      try { localStorage.setItem(RECORDS_KEY, JSON.stringify(next)); } catch { /* Armazenamento opcional. */ }
      setRecords(next);
    }
    playSound("win");
    const timeout = window.setTimeout(() => {
      if (dialogRef.current && !dialogRef.current.open) dialogRef.current.showModal();
    }, 550);
    return () => window.clearTimeout(timeout);
  // A conclusão de uma partida só ocorre uma vez.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.status]);

  useEffect(() => () => {
    if (audioContextRef.current) void audioContextRef.current.close();
  }, []);

  function restart(level = game.level) {
    if (dialogRef.current?.open) dialogRef.current.close();
    setIsNewRecord(false);
    dispatch({ type: "RESTART", level });
  }

  function handleCardClick(index) {
    if (game.status === "won" || game.selected.length === 2 ||
        game.selected.includes(index) || game.matched.includes(game.cards[index].id)) return;
    playSound(game.selected.length === 0 ? "flip" :
      game.cards[game.selected[0]].id === game.cards[index].id ? "match" : "miss");
    dispatch({ type: "FLIP", index, now: Date.now() });
  }

  function toggleSound() {
    const next = !soundEnabled;
    setSoundEnabled(next);
    try { localStorage.setItem(SOUND_KEY, next ? "on" : "off"); }
    catch { /* Armazenamento opcional. */ }
  }

  return (
    <>
<div className="top-race-bar" aria-hidden="true">
    <div className="top-race-track"><span>PARES RACING CLUB</span><span>✳</span><span>MEMORY GRAND PRIX</span><span>✳</span><span>FOCO • REFLEXO • VELOCIDADE</span><span>✳</span><span>PARES RACING CLUB</span></div>
  </div>
  <div className="site-wrap">
    <header className="site-header">
      <a href="./" className="brand" aria-label="PARES, início">
        <span className="brand-mark" aria-hidden="true">P<span>✳</span></span>
        <span className="brand-word">PARES<span>.</span></span>
      </a>
      <div className="header-middle" aria-hidden="true"><span className="line-flag"></span> DESAFIO DE MEMÓRIA / EDIÇÃO 01</div>
      <button id="soundToggle" className="sound-toggle" type="button" aria-label={soundEnabled ? "Desativar som" : "Ativar som"} aria-pressed={soundEnabled} onClick={toggleSound} title="Ativar ou desativar som">
        <svg id="soundIcon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M11 5 6 9H3v6h3l5 4V5Z"></path><path className="sound-wave" d="M15 9a5 5 0 0 1 0 6"></path><path className="sound-wave" d="M18 6a9 9 0 0 1 0 12"></path><path className="sound-mute" d="m16 9 5 6m0-6-5 6"></path>
        </svg>
        <span id="soundLabel">{soundEnabled ? 'Som ligado' : 'Som desligado'}</span>
        <span className="sound-tick" aria-hidden="true"></span>
      </button>
    </header>

    <main>
      <section className="hero" aria-labelledby="pageTitle">
        <div className="hero-ink hero-ink-a" aria-hidden="true"></div>
        <div className="hero-ink hero-ink-b" aria-hidden="true"></div>
        <div className="hero-copy">
          <div className="hero-eyebrow"><span className="hero-indicator" aria-hidden="true"></span> JOGO DA MEMÓRIA <span className="eyebrow-separator">/</span> VOL. 001</div>
          <h1 id="pageTitle">SUA MENTE.<br><span>SEM FREIOS.</span></h1>
          <p>Na pista da memória, cada segundo conta. Revele as cartas, encontre os pares e prove que você não perde o foco.</p>
          <a href="#arena" className="hero-cta">ENTRAR NA PISTA <span aria-hidden="true">↘</span></a>
          <div className="hero-footnote"><span className="mini-star" aria-hidden="true">✳</span> VELOCIDADE É NADA SEM CONCENTRAÇÃO.</div>
        </div>
        <div className="hero-art" aria-hidden="true">
          <div className="hero-art-number">01</div>
          <img src={racerArt} alt="" width="940" height="790" />
          <span className="art-caption">MIND / <b>RACER</b></span>
          <span className="art-crosshair art-crosshair-a">+</span>
          <span className="art-crosshair art-crosshair-b">+</span>
        </div>
        <div className="hero-side-label" aria-hidden="true">KEEP YOUR EYES ON THE GAME — 001</div>
      </section>

      <div className="section-break" aria-hidden="true">
        <span className="section-break-dark">A CORRIDA COMEÇA AQUI</span>
        <span className="section-break-lines">///// ///// ///// ///// /////</span>
        <span className="section-break-red">START YOUR ENGINE <b>↗</b></span>
      </div>

      <section id="arena" className="game-layout" aria-label="Jogo da memória">
        <div className="play-panel">
          <div className="panel-heading">
            <div>
              <div className="section-kicker"><span className="small-flag" aria-hidden="true">✳</span> GRID DE LARGADA / <strong>LIVE</strong></div>
              <h2>ENCONTRE OS <em>PARES.</em> <span id="boardCount" className="pair-total">{game.matched.length}/{LEVEL_PAIRS[game.level]}</span></h2>
            </div>
            <button id="shuffleButton" className="subtle-button" type="button" title="Recomeçar com as cartas embaralhadas" onClick={() => restart()}><span aria-hidden="true">↻</span> NOVA CORRIDA</button>
          </div>
          <div className="board-grid-frame">
            <div className="board-rail rail-top" aria-hidden="true"><span>START</span><span>MEMORY / 001</span></div>
            <div id="board" className={"board level-" + game.level} role="group" aria-label={(LEVEL_PAIRS[game.level] * 2) + " cartas, " + LEVEL_PAIRS[game.level] + " pares"}>{game.cards.map((card, index) => { const matched = game.matched.includes(card.id); const flipped = matched || game.selected.includes(index); return (<button key={card.key} type="button" className={"memory-card" + (matched ? " is-matched" : flipped ? " is-flipped" : "")} disabled={matched} onClick={() => handleCardClick(index)} aria-label={"Carta " + (index + 1) + (matched ? ", par de " + card.name + " encontrado" : flipped ? ", " + card.name + ", revelada" : ", virada para baixo")}><span className="card-inner" aria-hidden="true"><span className="card-face card-front"><span className="card-glyph">P</span><span className="card-corner">R/01</span></span><span className="card-face card-back" style={{ "--pair-color": card.color }}><span className="card-emoji">{card.icon}</span></span></span></button>); })}</div>
            <div className="board-rail rail-bottom" aria-hidden="true"><span>FIND YOUR MATCH //</span><span>FINISH</span></div>
          </div>
          <div className="board-footer">
            <span className="tip-icon" aria-hidden="true">✦</span>
            <span id="gameMessage" role="status" aria-live="polite">{game.message}</span>
            <span className="board-foot-tag">PARES RACING CLUB</span>
          </div>
        </div>

        <aside className="game-sidebar" aria-label="Configurações e resultados">
          <section className="side-card difficulty-card">
            <div className="side-overline"><span>01</span> / AJUSTE O DESAFIO</div>
            <div className="sidebar-title-line"><h2>ESCOLHA A <em>MARCHA.</em></h2><span aria-hidden="true">↗</span></div>
            <p>Quanto maior a velocidade, maior o desafio.</p>
            <div className="difficulty-options" role="group" aria-label="Dificuldade">
              <button type="button" className={"difficulty-button" + (game.level === "easy" ? " active" : "")} data-level="easy" aria-pressed={game.level === "easy"} onClick={() => restart("easy")}><span className="level-code">01</span><span className="level-name">INICIANTE</span><small>6 PARES</small><span className="level-chevron" aria-hidden="true">↗</span></button>
              <button type="button" className={"difficulty-button" + (game.level === "medium" ? " active" : "")} data-level="medium" aria-pressed={game.level === "medium"} onClick={() => restart("medium")}><span className="level-code">02</span><span className="level-name">PILOTO</span><small>8 PARES</small><span className="level-chevron" aria-hidden="true">↗</span></button>
              <button type="button" className={"difficulty-button" + (game.level === "hard" ? " active" : "")} data-level="hard" aria-pressed={game.level === "hard"} onClick={() => restart("hard")}><span className="level-code">03</span><span className="level-name">LENDA</span><small>10 PARES</small><span className="level-chevron" aria-hidden="true">↗</span></button>
            </div>
          </section>

          <section className="side-card stats-card">
            <div className="side-overline"><span>02</span> / TELEMETRIA</div>
            <div className="sidebar-title-line"><h2>NO <em>LIMITE.</em></h2><span className="stats-star" aria-hidden="true">✳</span></div>
            <div className="stats-grid">
              <div className="stat-box"><span className="stat-label">JOGADAS</span><strong id="movesStat" className="stat-number">{String(game.moves).padStart(2, '0')}</strong></div>
              <div className="stat-box"><span className="stat-label">TEMPO</span><strong id="timeStat" className="stat-number" aria-label="Tempo decorrido">{formatTime(game.elapsed)}</strong></div>
              <div className="stat-box"><span className="stat-label">ACERTOS</span><strong id="matchesStat" className="stat-number">{String(game.matched.length).padStart(2, '0')}</strong></div>
              <div className="stat-box"><span className="stat-label">PONTOS</span><strong id="scoreStat" className="stat-number accent-number">{String(score).padStart(3, '0')}</strong></div>
            </div>
            <div className="progress-heading"><span>PROGRESSO DA PISTA</span><strong id="progressText">{progress}%</strong></div>
            <div className="progress-track" role="progressbar" aria-label="Pares encontrados" aria-valuemin="0" aria-valuemax="100" aria-valuenow={progress} id="progressTrack"><span id="progressFill" style={{ width: progress + "%" }}></span></div>
            <div className="record-box"><span className="record-icon" aria-hidden="true">★</span><div><small>RECORDE PESSOAL</small><strong id="bestScore">{bestRecord ? bestRecord.score + ' pts · ' + formatTime(bestRecord.elapsed) : 'Ainda não há recorde'}</strong></div></div>
          </section>

          <button id="restartButton" type="button" className="restart-button" onClick={() => restart()}><span>REINICIAR CORRIDA</span><span className="restart-arrow" aria-hidden="true">↗</span></button>
          <p className="sidebar-note">+100 pontos por par • −15 por erro • −5 a cada 10 segundos. Seu melhor resultado fica salvo neste navegador.</p>
        </aside>
      </section>
    </main>
    <footer className="site-footer">
      <span className="footer-brand">PARES<span>.</span></span>
      <span>A MEMÓRIA NUNCA SAI DE PISTA.</span>
      <span>© 2026 / MEMORY RACING CLUB <span className="footer-star" aria-hidden="true">✳</span></span>
    </footer>
  </div>

  <dialog id="winDialog" ref={dialogRef} onCancel={(event) => event.preventDefault()} className="win-dialog" aria-labelledby="winTitle">
    <div id="confetti" className="confetti" aria-hidden="true">{confettiPieces.map((piece, index) => <i key={index} style={piece} />)}</div>
    <div className="win-content">
      <span className="win-emblem" aria-hidden="true">★</span>
      <span className="win-kicker">BANDEIRA QUADRICULADA / PARABÉNS</span>
      <h2 id="winTitle">VOCÊ CRUZOU<br><em>A LINHA DE CHEGADA.</em></h2>
      <p id="winMessage">{isNewRecord ? 'Volta histórica! Novo recorde pessoal. 🏆' : 'Você venceu! Que tal bater esse tempo na próxima volta?'}</p>
      <div className="win-stats">
        <div><span>JOGADAS</span><strong id="winMoves">{game.moves}</strong></div>
        <div><span>TEMPO</span><strong id="winTime">{formatTime(game.elapsed)}</strong></div>
        <div><span>PONTOS</span><strong id="winScore">{score}</strong></div>
      </div>
      <button id="playAgainButton" className="play-again-button" type="button" onClick={() => restart()}>ACELERAR DE NOVO <span aria-hidden="true">↗</span></button>
    </div>
  </dialog>
    </>
  );
}
