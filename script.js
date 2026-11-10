"use strict";

(() => {
  const ITEMS = [
    { id: "planet", icon: "🪐", name: "planeta", color: "#b8a4ff" },
    { id: "rocket", icon: "🚀", name: "foguete", color: "#ffb7b1" },
    { id: "star", icon: "🌟", name: "estrela", color: "#ffe197" },
    { id: "moon", icon: "🌙", name: "lua", color: "#c8d5ff" },
    { id: "alien", icon: "👽", name: "alienígena", color: "#9ae5b2" },
    { id: "comet", icon: "☄️", name: "cometa", color: "#ffb99d" },
    { id: "earth", icon: "🌎", name: "Terra", color: "#7ad5d7" },
    { id: "satellite", icon: "🛰️", name: "satélite", color: "#bcc6e7" },
    { id: "sun", icon: "☀️", name: "sol", color: "#f8d080" },
    { id: "ufo", icon: "🛸", name: "disco voador", color: "#bde0ff" }
  ];

  const DIFFICULTY = { easy: 6, medium: 8, hard: 10 };
  const STORAGE_KEY = "pares-records-v1";
  const SOUND_KEY = "pares-sound-v1";
  const $ = (id) => document.getElementById(id);

  const board = $("board");
  const message = $("gameMessage");
  const dialog = $("winDialog");
  const soundToggle = $("soundToggle");
  const difficultyButtons = Array.from(document.querySelectorAll(".difficulty-button"));

  let level = "easy";
  let totalPairs = DIFFICULTY[level];
  let firstCard = null;
  let secondCard = null;
  let locked = false;
  let moves = 0;
  let matches = 0;
  let mistakes = 0;
  let startedAt = null;
  let finishedAt = null;
  let timerInterval = null;
  let hideTimeout = null;
  let winTimeout = null;
  let soundEnabled = readSetting(SOUND_KEY) === "on";
  let audioContext = null;

  function readSetting(key) {
    try { return localStorage.getItem(key); }
    catch { return null; }
  }

  function writeSetting(key, value) {
    try { localStorage.setItem(key, value); }
    catch { /* Modo privado ou armazenamento indisponível. */ }
  }

  function getRecord() {
    try {
      const records = JSON.parse(readSetting(STORAGE_KEY) || "{}");
      const entry = records[level];
      if (entry && Number.isFinite(entry.score) && Number.isFinite(entry.elapsed) && Number.isFinite(entry.moves)) {
        return entry;
      }
    } catch { /* Dados ausentes ou inválidos. */ }
    return null;
  }

  function saveRecord(record) {
    try {
      let records = {};
      try {
        const stored = JSON.parse(readSetting(STORAGE_KEY) || "{}");
        if (stored && typeof stored === "object" && !Array.isArray(stored)) records = stored;
      } catch { /* Ignora dados inválidos. */ }
      records[level] = record;
      writeSetting(STORAGE_KEY, JSON.stringify(records));
    } catch { /* O jogo continua sem persistência. */ }
  }

  function shuffle(array) {
    const result = array.slice();
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }

  function formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return String(mins).padStart(2, "0") + ":" + String(secs).padStart(2, "0");
  }

  function getElapsedSeconds() {
    if (startedAt === null) return 0;
    return Math.floor(((finishedAt === null ? performance.now() : finishedAt) - startedAt) / 1000);
  }

  function getScore() {
    return Math.max(0, matches * 100 - mistakes * 15 - Math.floor(getElapsedSeconds() / 10) * 5);
  }

  function updateDisplay() {
    $("boardCount").textContent = matches + "/" + totalPairs;
    $("movesStat").textContent = String(moves).padStart(2, "0");
    $("matchesStat").textContent = String(matches).padStart(2, "0");
    $("timeStat").textContent = formatTime(getElapsedSeconds());
    $("scoreStat").textContent = String(getScore()).padStart(3, "0");

    const progress = Math.round((matches / totalPairs) * 100);
    $("progressText").textContent = progress + "%";
    $("progressFill").style.width = progress + "%";
    $("progressTrack").setAttribute("aria-valuenow", String(progress));

    const best = getRecord();
    $("bestScore").textContent = best ? best.score + " pts · " + formatTime(best.elapsed) : "Ainda não há recorde";
  }

  function setMessage(text) {
    message.textContent = text;
  }

  function sound(type) {
    if (!soundEnabled) return;
    try {
      const Context = window.AudioContext || window.webkitAudioContext;
      if (!Context) return;
      if (!audioContext) audioContext = new Context();
      if (audioContext.state === "suspended") void audioContext.resume();
      const sequence = {
        flip: [420],
        match: [570, 780],
        miss: [260],
        win: [520, 680, 880]
      }[type] || [];
      sequence.forEach((frequency, i) => {
        const oscillator = audioContext.createOscillator();
        const volume = audioContext.createGain();
        const time = audioContext.currentTime + i * .09;
        oscillator.type = "sine";
        oscillator.frequency.setValueAtTime(frequency, time);
        volume.gain.setValueAtTime(.0001, time);
        volume.gain.exponentialRampToValueAtTime(.09, time + .012);
        volume.gain.exponentialRampToValueAtTime(.0001, time + .11);
        oscillator.connect(volume);
        volume.connect(audioContext.destination);
        oscillator.start(time);
        oscillator.stop(time + .12);
      });
    } catch { /* Áudio é opcional; falhas não interrompem o jogo. */ }
  }

  function updateSoundUI() {
    soundToggle.setAttribute("aria-pressed", String(soundEnabled));
    soundToggle.setAttribute("aria-label", soundEnabled ? "Desativar som" : "Ativar som");
    $("soundLabel").textContent = soundEnabled ? "Som ligado" : "Som desligado";
  }

  function createCard(item, index) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "memory-card";
    button.setAttribute("aria-label", "Carta " + (index + 1) + ", virada para baixo");

    const inner = document.createElement("span");
    inner.className = "card-inner";
    inner.setAttribute("aria-hidden", "true");

    const front = document.createElement("span");
    front.className = "card-face card-front";
    const glyph = document.createElement("span");
    glyph.className = "card-glyph";
    glyph.textContent = "✳";
    const corner = document.createElement("span");
    corner.className = "card-corner";
    corner.textContent = "P.";
    front.append(glyph, corner);

    const back = document.createElement("span");
    back.className = "card-face card-back";
    back.style.setProperty("--pair-color", item.color);
    const emoji = document.createElement("span");
    emoji.className = "card-emoji";
    emoji.textContent = item.icon;
    back.append(emoji);

    inner.append(front, back);
    button.append(inner);
    button.addEventListener("click", () => chooseCard(button, item, index + 1));
    return button;
  }

  function turnCard(button, item, number) {
    button.classList.add("is-flipped");
    button.setAttribute("aria-label", "Carta " + number + ", " + item.name + ", revelada");
  }

  function chooseCard(button, item, number) {
    if (locked || finishedAt !== null || button.classList.contains("is-flipped") || button.classList.contains("is-matched")) return;

    if (startedAt === null) {
      startedAt = performance.now();
      timerInterval = window.setInterval(updateDisplay, 250);
    }

    turnCard(button, item, number);
    sound("flip");

    if (firstCard === null) {
      firstCard = { button, item, number };
      setMessage("Boa! Agora encontre a carta com o mesmo símbolo.");
      updateDisplay();
      return;
    }

    secondCard = { button, item, number };
    moves += 1;

    if (firstCard.item.id === secondCard.item.id) {
      const pairName = item.name;
      firstCard.button.classList.add("is-matched");
      secondCard.button.classList.add("is-matched");
      firstCard.button.setAttribute("aria-label", "Carta " + firstCard.number + ", par de " + pairName + " encontrado");
      secondCard.button.setAttribute("aria-label", "Carta " + number + ", par de " + pairName + " encontrado");
      firstCard.button.disabled = true;
      secondCard.button.disabled = true;
      matches += 1;
      firstCard = null;
      secondCard = null;
      sound("match");
      setMessage("Par encontrado! Continue assim.");
      updateDisplay();
      if (matches === totalPairs) finishGame();
    } else {
      mistakes += 1;
      locked = true;
      sound("miss");
      setMessage("Ainda não! Memorize as posições e tente de novo.");
      updateDisplay();
      hideTimeout = window.setTimeout(() => {
        for (const selected of [firstCard, secondCard]) {
          selected.button.classList.remove("is-flipped");
          selected.button.setAttribute("aria-label", "Carta " + selected.number + ", virada para baixo");
        }
        firstCard = null;
        secondCard = null;
        locked = false;
        hideTimeout = null;
        setMessage("Sua vez! Vire mais duas cartas.");
      }, 950);
    }
  }

  function makeConfetti() {
    const container = $("confetti");
    container.replaceChildren();
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const colors = ["#a8f3c3", "#bea7ff", "#ffbdac", "#ffe4a8", "#a4d8ff"];
    for (let i = 0; i < 35; i++) {
      const piece = document.createElement("i");
      piece.style.left = Math.random() * 100 + "%";
      piece.style.setProperty("--confetti-color", colors[i % colors.length]);
      piece.style.setProperty("--fall-duration", (1.7 + Math.random() * 1.4) + "s");
      piece.style.setProperty("--fall-delay", (Math.random() * .9) + "s");
      piece.style.setProperty("--fall-angle", Math.round(Math.random() * 360) + "deg");
      container.append(piece);
    }
  }

  function finishGame() {
    finishedAt = performance.now();
    window.clearInterval(timerInterval);
    timerInterval = null;
    updateDisplay();
    sound("win");

    const score = getScore();
    const elapsed = getElapsedSeconds();
    const previous = getRecord();
    const isRecord = !previous || score > previous.score || (score === previous.score && elapsed < previous.elapsed);
    if (isRecord) saveRecord({ score, elapsed, moves });
    updateDisplay();

    $("winMoves").textContent = String(moves);
    $("winTime").textContent = formatTime(elapsed);
    $("winScore").textContent = String(score);
    $("winMessage").textContent = isRecord
      ? "Novo recorde! Você superou sua melhor marca. ✨"
      : "Todas as cartas encontradas! Que tal superar sua pontuação?";
    setMessage("Você venceu! Todos os pares foram encontrados.");
    winTimeout = window.setTimeout(() => {
      makeConfetti();
      if (!dialog.open) dialog.showModal();
      winTimeout = null;
    }, 550);
  }

  function newGame() {
    window.clearTimeout(hideTimeout);
    window.clearTimeout(winTimeout);
    window.clearInterval(timerInterval);
    hideTimeout = null;
    winTimeout = null;
    timerInterval = null;
    if (dialog.open) dialog.close();

    totalPairs = DIFFICULTY[level];
    firstCard = null;
    secondCard = null;
    locked = false;
    moves = 0;
    matches = 0;
    mistakes = 0;
    startedAt = null;
    finishedAt = null;

    const pairs = shuffle(ITEMS).slice(0, totalPairs);
    const cards = shuffle(pairs.flatMap((item) => [item, item]));
    board.className = "board level-" + level;
    board.setAttribute("aria-label", totalPairs * 2 + " cartas, " + totalPairs + " pares");
    board.replaceChildren(...cards.map((item, index) => createCard(item, index)));
    setMessage("Vire duas cartas para começar a jogar.");
    updateDisplay();
  }

  function setLevel(nextLevel) {
    if (!Object.hasOwn(DIFFICULTY, nextLevel)) return;
    level = nextLevel;
    difficultyButtons.forEach((button) => {
      const active = button.dataset.level === nextLevel;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    newGame();
  }

  difficultyButtons.forEach((button) => {
    button.addEventListener("click", () => setLevel(button.dataset.level));
  });
  $("shuffleButton").addEventListener("click", newGame);
  $("restartButton").addEventListener("click", newGame);
  $("playAgainButton").addEventListener("click", newGame);
  soundToggle.addEventListener("click", () => {
    soundEnabled = !soundEnabled;
    writeSetting(SOUND_KEY, soundEnabled ? "on" : "off");
    updateSoundUI();
    if (soundEnabled) sound("flip");
  });

  updateSoundUI();
  setLevel("easy");
})();