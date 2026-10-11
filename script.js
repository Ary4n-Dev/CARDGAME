/**
 * Doodle Card Match — script.js
 * 2-Player Turn-Based Memory Matching Game
 * Vanilla HTML/CSS/JS, Web Audio API, no external dependencies
 */

'use strict';

/* ══════════════════════════════════════════════════
   CONSTANTS & CONFIG
   ══════════════════════════════════════════════════ */
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const SUITS = ['heart', 'spade'];
const SUIT_SYMBOL = { heart: '♥', spade: '♠' };
const FACE_DISPLAY = { J: 'J', Q: 'Q', K: 'K' };
const MATCH_DELAY   = 700;
const MISMATCH_DELAY= 1050;
const PARTICLE_COUNT= 18;

const PLAYER_NAMES = ['Player 1', 'Player 2'];
const PLAYER_EMOJI = ['🌸', '🌊'];

/**
 * Pip positions: [left%, top%]
 * Pips with top > 52 are rendered rotated 180° (upside-down) per card convention.
 */
const PIP_POSITIONS = {
  'A':  [[50, 50]],
  '2':  [[50, 25], [50, 75]],
  '3':  [[50, 20], [50, 50], [50, 80]],
  '4':  [[28, 25], [72, 25], [28, 75], [72, 75]],
  '5':  [[28, 25], [72, 25], [50, 50], [28, 75], [72, 75]],
  '6':  [[28, 22], [72, 22], [28, 50], [72, 50], [28, 78], [72, 78]],
  '7':  [[28, 20], [72, 20], [50, 36], [28, 53], [72, 53], [28, 76], [72, 76]],
  '8':  [[28, 19], [72, 19], [50, 34], [28, 50], [72, 50], [50, 66], [28, 81], [72, 81]],
  '9':  [[28, 18], [72, 18], [28, 38], [72, 38], [50, 50], [28, 62], [72, 62], [28, 82], [72, 82]],
  '10': [[28, 15], [72, 15], [50, 28], [28, 42], [72, 42], [28, 58], [72, 58], [50, 72], [28, 85], [72, 85]],
};

/* ══════════════════════════════════════════════════
   WEB AUDIO — Synthesised Sounds
   ══════════════════════════════════════════════════ */
let audioCtx = null;

function getAudioCtx() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  return audioCtx;
}

function playTone({ frequency = 440, type = 'sine', duration = 0.12,
                    gainStart = 0.18, gainEnd = 0, startDelay = 0,
                    detune = 0 } = {}) {
  try {
    const ctx  = getAudioCtx();
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type      = type;
    osc.frequency.value = frequency;
    osc.detune.value    = detune;
    const now = ctx.currentTime + startDelay;
    gain.gain.setValueAtTime(gainStart, now);
    gain.gain.exponentialRampToValueAtTime(Math.max(gainEnd, 0.001), now + duration);
    osc.start(now);
    osc.stop(now + duration + 0.01);
  } catch (_) { /* silently skip if audio blocked */ }
}

/** Cute pop — flip sound */
function soundFlip() {
  playTone({ frequency: 880, type: 'sine',   duration: 0.08, gainStart: 0.12 });
  playTone({ frequency: 660, type: 'triangle', duration: 0.06, gainStart: 0.06, startDelay: 0.04 });
}

/** Uplifting chime — match sound */
function soundMatch() {
  const notes = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6
  notes.forEach((f, i) => {
    playTone({ frequency: f, type: 'sine', duration: 0.35, gainStart: 0.14,
               startDelay: i * 0.09, detune: 5 });
    playTone({ frequency: f * 2, type: 'triangle', duration: 0.2, gainStart: 0.04,
               startDelay: i * 0.09 });
  });
}

/** Soft thud — mismatch */
function soundMismatch() {
  playTone({ frequency: 220, type: 'triangle', duration: 0.18, gainStart: 0.16 });
  playTone({ frequency: 180, type: 'sawtooth', duration: 0.12, gainStart: 0.05, startDelay: 0.08 });
}

/** Win fanfare */
function soundWin() {
  const melody = [523, 659, 784, 880, 784, 1047];
  melody.forEach((f, i) => {
    playTone({ frequency: f, type: 'sine',     duration: 0.28, gainStart: 0.18, startDelay: i * 0.12 });
    playTone({ frequency: f, type: 'triangle', duration: 0.22, gainStart: 0.06, startDelay: i * 0.12 });
  });
}

/* ══════════════════════════════════════════════════
   GAME STATE & MULTIPLAYER
   ══════════════════════════════════════════════════ */
const state = {
  deck:          [],   // array of card objects {id, rank, suit, index}
  flipped:       [],   // indices of currently face-up (unmatched) cards
  matched:       new Set(),
  currentPlayer: 0,    // 0 or 1
  scores:        [0, 0],
  locked:        false, // prevent clicks during animations
  pairsFound:    0,
  // Multiplayer
  isMultiplayer: false,
  isHost:        false,
  myPlayerIndex: 0,     // 0 = P1 (Host), 1 = P2 (Guest)
  roomCode:      null,
  peer:          null,
  conn:          null,
};

/* ══════════════════════════════════════════════════
   DOM REFS
   ══════════════════════════════════════════════════ */
const $board        = document.getElementById('game-board');
const $p1Score      = document.getElementById('p1-score');
const $p2Score      = document.getElementById('p2-score');
const $p1Label      = document.getElementById('p1-label');
const $p2Label      = document.getElementById('p2-label');
const $p1Panel      = document.getElementById('p1-panel');
const $p2Panel      = document.getElementById('p2-panel');
const $p1Crown      = document.getElementById('p1-crown');
const $p2Crown      = document.getElementById('p2-crown');
const $ribbonText   = document.getElementById('ribbon-text');
const $ribbonSub    = document.getElementById('ribbon-sub');
const $turnRibbon   = document.getElementById('turn-ribbon');
const $pairsFound   = document.getElementById('pairs-found');
const $btnRestart   = document.getElementById('btn-restart');
const $modalOverlay = document.getElementById('modal-overlay');
const $modalWinner  = document.getElementById('modal-winner');
const $modalP1Score = document.getElementById('modal-p1-score');
const $modalP2Score = document.getElementById('modal-p2-score');
const $btnPlayAgain = document.getElementById('btn-play-again');
const $particles    = document.getElementById('particles-container');

// Multiplayer DOM
const $roomActions    = document.getElementById('room-actions');
const $roomInfo       = document.getElementById('room-info');
const $btnCreateRoom  = document.getElementById('btn-create-room');
const $btnJoinRoom    = document.getElementById('btn-join-room');
const $inputRoomCode  = document.getElementById('input-room-code');
const $displayRoomCode= document.getElementById('display-room-code');
const $btnCopyCode    = document.getElementById('btn-copy-code');
const $roomStatusDot  = document.getElementById('room-status-dot');
const $roomStatusText = document.getElementById('room-status-text');
const $roleBadge      = document.getElementById('role-badge');
const $btnLocalMode   = document.getElementById('btn-local-mode');

/* ══════════════════════════════════════════════════
   DECK GENERATION & SHUFFLE
   ══════════════════════════════════════════════════ */
function buildDeck() {
  const cards = [];
  let id = 0;
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      // Two copies per unique card (one pair)
      cards.push({ id: id++, rank, suit, pairKey: `${rank}-${suit}` });
      cards.push({ id: id++, rank, suit, pairKey: `${rank}-${suit}` });
    }
  }
  return shuffleArray(cards);
}

function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* ══════════════════════════════════════════════════
   CARD ELEMENT BUILDER
   ══════════════════════════════════════════════════ */

/** Build a single pip span at the given percentage position */
function makePip(symbol, left, top, isAce) {
  const pip = document.createElement('span');
  pip.className = isAce ? 'pip pip-ace' : 'pip';
  pip.textContent = symbol;
  pip.style.left = `${left}%`;
  pip.style.top  = `${top}%`;
  // Traditional card convention: bottom-half pips are upside-down
  if (!isAce && top > 52) {
    pip.style.transform = 'translate(-50%, -50%) rotate(180deg)';
  }
  return pip;
}

/**
 * Returns classy royal court heraldic regalia (Imperial Crown, Queen Tiara, Knight Helm)
 * tailored in the card's suit color.
 */
function getRoyalSvg(rank, suit) {
  const isHeart = suit === 'heart';
  const suitColor = isHeart ? 'var(--heart-color)' : 'var(--spade-color)';

  if (rank === 'K') {
    // Imperial King Crown (Lorc / Game-Icons)
    return `
      <svg class="royal-card-svg royal-king" viewBox="0 0 512 512" width="36" height="36" fill="${suitColor}" xmlns="http://www.w3.org/2000/svg">
        <path d="m408.256 119.46-37.7 52.165 19.57 44.426 34.8-37.214-16.67-59.375zm86.074 12.513L384.44 249.498 334.01 135.02l-75.162 132.947-86.948-131.78-33.334 114.122L17.922 132.83l39.3 127.6c1.945-.348 3.94-.54 5.98-.54 18.812 0 34.26 15.452 34.26 34.262 0 13.823-8.346 25.822-20.235 31.22l5.337 17.33c12.425 25.466 71.863 45.152 176.582 47.206 110.805 2.174 178.12-17.54 189.854-47.207h-.002l4.357-20.26c-16.836-2.114-30.02-16.612-30.02-33.986 0-18.81 15.45-34.262 34.263-34.262 3.513 0 6.91.54 10.11 1.54l26.622-123.762zm-391.77 2.04 1.22 56.337 25.56 24.89 9.592-32.842-36.37-48.386zm150.585 2.91-24.483 51.36 28.955 43.885 24.922-44.08-29.395-51.166zm204.453 135.962c-8.712 0-15.575 6.862-15.575 15.572 0 8.71 6.863 15.574 15.575 15.574s15.572-6.863 15.572-15.573-6.86-15.572-15.572-15.572zM63.2 278.58c-8.71 0-15.573 6.864-15.573 15.574s6.862 15.573 15.574 15.573c8.713 0 15.573-6.862 15.573-15.573 0-8.71-6.86-15.574-15.572-15.574zm130.33 17.842c18.812 0 34.26 15.45 34.26 34.262 0 18.81-15.448 34.26-34.26 34.26-18.813 0-34.262-15.45-34.262-34.26s15.45-34.262 34.26-34.262zm131.234 0c18.812 0 34.26 15.45 34.26 34.262 0 18.81-15.448 34.26-34.26 34.26-18.813 0-34.262-15.45-34.262-34.26s15.45-34.262 34.262-34.262zm-131.235 18.69c-8.713 0-15.573 6.86-15.573 15.572 0 8.71 6.86 15.574 15.572 15.574 8.71 0 15.572-6.864 15.572-15.574s-6.86-15.573-15.573-15.573zm131.234 0c-8.712 0-15.573 6.86-15.573 15.572 0 8.71 6.862 15.574 15.574 15.574s15.574-6.864 15.574-15.574-6.862-15.573-15.574-15.573z"/>
      </svg>
    `;
  } else if (rank === 'Q') {
    // Elegant Queen Tiara (Lorc / Game-Icons)
    return `
      <svg class="royal-card-svg royal-queen" viewBox="0 0 512 512" width="36" height="36" fill="${suitColor}" xmlns="http://www.w3.org/2000/svg">
        <path d="M188.28 59.47c-19.086 0-34.56 15.468-34.56 34.56 0 16.077 10.983 29.57 25.843 33.44l-35.344 81.936c15.877 2.885 27.905 16.784 27.905 33.5 0 18.806-15.23 34.063-34.03 34.063-18.802 0-34.032-15.258-34.032-34.064 0-13.37 7.703-24.924 18.906-30.5l-50.814-79.22c8.007-5.82 13.22-15.24 13.22-25.905 0-17.693-14.314-32.06-32-32.06-17.688 0-32.032 14.37-32.032 32.06 0 17.693 14.344 32.032 32.03 32.032.734 0 1.468-.014 2.188-.062l41.907 227h316l41.936-227c.72.048 1.455.063 2.188.063 17.686 0 32.03-14.34 32.03-32.032 0-17.693-14.344-32.06-32.03-32.06-17.687 0-32.03 14.37-32.03 32.06-.002 10.723 5.286 20.187 13.373 26l-50.656 79.532c10.778 5.72 18.126 17.04 18.126 30.094 0 18.806-15.23 34.063-34.03 34.063s-34.032-15.258-34.032-34.064c0-17.11 12.602-31.267 29.03-33.687l-34.75-81.532c15.275-3.577 26.657-17.287 26.657-33.657 0-19.094-15.474-34.56-34.56-34.56-19.09 0-34.564 15.468-34.564 34.56 0 14.798 9.308 27.415 22.375 32.345L268 202.345c14.62 4.52 25.25 18.112 25.25 34.218 0 19.796-16.053 35.843-35.844 35.844-19.79 0-35.812-16.047-35.812-35.844 0-15.158 9.403-28.102 22.687-33.343l-44.124-76.72c13.234-4.845 22.688-17.552 22.688-32.47 0-19.094-15.475-34.56-34.563-34.56zM97.438 384.936c-23.978 3.763-22.86 39.844 4.188 39.844h6.656l.064.345h294.28l.063-.344h7.625c26.034 0 27.88-35.928 4.313-39.842H97.437z"/>
      </svg>
    `;
  } else if (rank === 'J') {
    // Knight Visored Helm (Lorc / Game-Icons)
    return `
      <svg class="royal-card-svg royal-jack" viewBox="0 0 512 512" width="36" height="36" fill="${suitColor}" xmlns="http://www.w3.org/2000/svg">
        <path d="M258.094 18.5c-74.34 0-138.073 62.498-156.188 148.438 52.758-7.697 102.23-22.044 153.938-45.094l4.125-1.813 3.967 2.064c49.424 25.667 97.648 41.026 150.657 46.406-17.66-86.744-81.71-150-156.5-150zm1.28 122.156c-57.41 25.148-112.883 39.993-172.53 47 6.724 32.847 6.91 65.935-.5 98.938 89.29 41.602 231.648 43.154 340.594-.125-10.762-32.516-11.727-65.66-1.188-98.408-59.03-4.235-112.628-20.06-166.375-47.406zm-13.5 33.125h18.72v127.75h-18.72V173.78zm-58.78 11.19h18.687v101.655h-18.686V184.97zm115.72 0H321.5v101.655h-18.688V184.97zm-171.72 14.905h18.687v79.28h-18.686v-79.28zm227.72 0H377.5v79.28h-18.688v-79.28zm38.748 116.75c-14.302 4.282-28.96 7.873-43.78 10.844l-19.22 64.06c26.114-17.337 48.002-43.31 63-74.905zm-277.53 2.875c13.95 28.257 33.448 51.85 56.562 68.53l-17.688-58.905c-13.397-2.61-26.387-5.826-38.875-9.625zm213.156 11.656c-51.63 8.175-104.745 8.588-153.72 1.438l20.845 69.5c18 8.52 37.49 13.187 57.78 13.187 18.588 0 36.507-3.92 53.22-11.124l21.875-73zm-195.5 47.156c-19.436 21.562-36.416 44.367-48.594 72.157 70.233-8.736 133.743 14.684 168.03 50.75 39.684-35.607 103.71-55.685 170.876-44.25-15.08-29.372-33.32-51.982-53.938-74-31.187 31.75-71.53 51-115.968 51-46.568 0-88.65-21.142-120.406-55.658z"/>
      </svg>
    `;
  }
  return '';
}

function buildCardEl(cardData, index) {
  const { rank, suit, pairKey } = cardData;
  const symbol = SUIT_SYMBOL[suit];

  const card = document.createElement('div');
  card.className = `card ${suit}`;
  card.dataset.index   = index;
  card.dataset.pairKey = pairKey;
  card.setAttribute('role', 'listitem');
  card.setAttribute('aria-label', `${rank} of ${suit}s`);

  const inner = document.createElement('div');
  inner.className = 'card-inner';

  /* ── Back face — CSS diamond pattern ── */
  const back = document.createElement('div');
  back.className = 'card-face card-back';
  const backFrame = document.createElement('div');
  backFrame.className = 'card-back-frame';
  back.appendChild(backFrame);

  /* ── Front face ── */
  const front = document.createElement('div');
  front.className = 'card-face card-front';

  // Top-left corner index
  const tlCorner = document.createElement('div');
  tlCorner.className = 'card-corner card-corner-tl';
  tlCorner.innerHTML = `<b class="c-rank">${rank}</b><span class="c-suit">${symbol}</span>`;

  // Bottom-right corner index (CSS rotation)
  const brCorner = document.createElement('div');
  brCorner.className = 'card-corner card-corner-br';
  brCorner.innerHTML = `<b class="c-rank">${rank}</b><span class="c-suit">${symbol}</span>`;

  front.appendChild(tlCorner);
  front.appendChild(brCorner);

  const isFace = rank === 'J' || rank === 'Q' || rank === 'K';

  if (isFace) {
    /* ── Face card: Classy Royal Court SVG illustration ── */
    const faceDiv = document.createElement('div');
    faceDiv.className = 'card-face-center';
    faceDiv.innerHTML = `
      <div class="royal-figure">${getRoyalSvg(rank, suit)}</div>
      <span class="face-letter">${rank}</span>
    `;
    front.appendChild(faceDiv);

  } else {
    /* ── Pip card (A through 10) ── */
    const pipArea = document.createElement('div');
    pipArea.className = 'card-pips';
    const positions = PIP_POSITIONS[rank];
    const isAce = rank === 'A';
    positions.forEach(([left, top]) => {
      pipArea.appendChild(makePip(symbol, left, top, isAce));
    });
    front.appendChild(pipArea);
  }

  inner.appendChild(back);
  inner.appendChild(front);
  card.appendChild(inner);

  card.addEventListener('click', () => onCardClick(card, index));
  return card;
}


/* ══════════════════════════════════════════════════
   BOARD RENDER
   ══════════════════════════════════════════════════ */
function renderBoard() {
  $board.innerHTML = '';
  state.deck.forEach((cardData, index) => {
    const el = buildCardEl(cardData, index);
    el.style.animationDelay = `${index * 18}ms`;
    $board.appendChild(el);
  });
}

function getCardEl(index) {
  return $board.querySelector(`.card[data-index="${index}"]`);
}

/* ══════════════════════════════════════════════════
   UI UPDATES
   ══════════════════════════════════════════════════ */
function updateScoreUI() {
  $p1Score.textContent = state.scores[0];
  $p2Score.textContent = state.scores[1];
  $pairsFound.textContent = state.pairsFound;
}

function updateTurnUI(goAgain = false) {
  const p = state.currentPlayer;
  const name = PLAYER_NAMES[p];
  const emoji = PLAYER_EMOJI[p];

  if (state.isMultiplayer) {
    const isMyTurn = (state.myPlayerIndex === p);
    if (goAgain) {
      $ribbonText.textContent = isMyTurn ? `Bonus Turn! Go Again` : `Friend matched! Bonus turn...`;
      $ribbonSub.textContent  = isMyTurn ? `It's still your turn~` : `Wait for your friend's turn~`;
    } else {
      $ribbonText.textContent = isMyTurn ? `Your Turn (${name})` : `${name}'s Turn (Opponent)`;
      $ribbonSub.textContent  = isMyTurn ? `Pick 2 cards to flip!` : `Waiting for friend to pick...`;
    }
  } else {
    if (goAgain) {
      $ribbonText.textContent = `Go Again, ${name}!`;
      $ribbonSub.textContent  = 'Bonus turn unlocked~';
    } else {
      $ribbonText.textContent = `${name}'s Turn`;
      $ribbonSub.textContent  = 'Flip 2 cards to find a match~';
    }
  }

  if (goAgain) {
    $turnRibbon.classList.remove('go-again');
    void $turnRibbon.offsetWidth; // force reflow
    $turnRibbon.classList.add('go-again');
  } else {
    $turnRibbon.classList.remove('go-again');
  }

  // Panel highlights
  $p1Panel.classList.toggle('active-player', p === 0);
  $p2Panel.classList.toggle('active-player', p === 1);
  $p1Crown.classList.toggle('visible', p === 0);
  $p2Crown.classList.toggle('visible', p === 1);
}

/* ══════════════════════════════════════════════════
   CARD FLIP LOGIC & MULTIPLAYER CHECK
   ══════════════════════════════════════════════════ */
function onCardClick(cardEl, index) {
  // In multiplayer: only active player can flip
  if (state.isMultiplayer) {
    if (state.myPlayerIndex !== state.currentPlayer) return;
    if (!state.conn || !state.conn.open) return;
  }

  if (state.locked) return;
  if (state.matched.has(index)) return;
  if (state.flipped.includes(index)) return;
  if (state.flipped.length >= 2) return;

  // Perform local flip
  executeCardFlip(index);

  // Broadcast flip to opponent
  if (state.isMultiplayer && state.conn && state.conn.open) {
    state.conn.send({ type: 'CARD_FLIP', index });
  }
}

function executeCardFlip(index) {
  const cardEl = getCardEl(index);
  if (!cardEl) return;
  cardEl.classList.add('flipped');
  state.flipped.push(index);
  soundFlip();

  if (state.flipped.length === 2) {
    state.locked = true;
    setTimeout(evaluatePair, 400);
  }
}

/* ══════════════════════════════════════════════════
   PAIR EVALUATION
   ══════════════════════════════════════════════════ */
function evaluatePair() {
  const [i1, i2] = state.flipped;
  const c1 = state.deck[i1];
  const c2 = state.deck[i2];
  const el1 = getCardEl(i1);
  const el2 = getCardEl(i2);

  if (c1.pairKey === c2.pairKey) {
    // ✅ MATCH
    soundMatch();

    setTimeout(() => {
      if (el1) el1.classList.add('matched');
      if (el2) el2.classList.add('matched');

      // Burst particles at both cards
      if (el1) burstParticles(el1);
      if (el2) burstParticles(el2);

      state.matched.add(i1);
      state.matched.add(i2);
      state.pairsFound++;
      state.scores[state.currentPlayer]++;
      state.flipped = [];
      state.locked  = false;

      updateScoreUI();
      updateTurnUI(true); // bonus turn

      if (state.pairsFound === 26) {
        setTimeout(showWinModal, 800);
      }
    }, MATCH_DELAY);

  } else {
    // ❌ MISMATCH
    soundMismatch();

    if (el1) el1.classList.add('shake');
    if (el2) el2.classList.add('shake');

    setTimeout(() => {
      if (el1) el1.classList.remove('flipped', 'shake');
      if (el2) el2.classList.remove('flipped', 'shake');
      state.flipped = [];

      // Switch player
      state.currentPlayer = state.currentPlayer === 0 ? 1 : 0;
      updateTurnUI(false);
      state.locked = false;
    }, MISMATCH_DELAY);
  }
}

/* ══════════════════════════════════════════════════
   PARTICLE BURST
   ══════════════════════════════════════════════════ */
const PARTICLE_COLORS = ['#FFB3C6','#B3F0D8','#D4C5F9','#FFE29A','#FFDAB9','#B3E5FC','#FFD700'];

function burstParticles(cardEl) {
  const rect = cardEl.getBoundingClientRect();
  const cx = rect.left + rect.width  / 2;
  const cy = rect.top  + rect.height / 2;

  for (let i = 0; i < PARTICLE_COUNT; i++) {
    const p = document.createElement('div');
    p.className = 'particle' + (Math.random() > 0.6 ? ' star' : '');
    const angle    = (Math.PI * 2 / PARTICLE_COUNT) * i + (Math.random() - 0.5) * 0.6;
    const distance = 55 + Math.random() * 80;
    const tx       = Math.cos(angle) * distance;
    const ty       = Math.sin(angle) * distance - 20;
    const dur      = 0.7 + Math.random() * 0.7;
    const delay    = Math.random() * 0.15;
    const size     = 6 + Math.random() * 8;
    const color    = PARTICLE_COLORS[Math.floor(Math.random() * PARTICLE_COLORS.length)];

    Object.assign(p.style, {
      left:       `${cx - size/2}px`,
      top:        `${cy - size/2}px`,
      width:      `${size}px`,
      height:     `${size}px`,
      background: color,
      '--tx':     `${tx}px`,
      '--ty':     `${ty}px`,
      '--dur':    `${dur}s`,
      '--delay':  `${delay}s`,
    });

    $particles.appendChild(p);
    p.addEventListener('animationend', () => p.remove());
  }
}

/* ══════════════════════════════════════════════════
   WIN MODAL
   ══════════════════════════════════════════════════ */
function showWinModal() {
  soundWin();

  const [s1, s2] = state.scores;
  let winnerText;
  if (state.isMultiplayer) {
    const iWon = (state.myPlayerIndex === 0 && s1 > s2) || (state.myPlayerIndex === 1 && s2 > s1);
    const tie = (s1 === s2);
    if (tie) {
      winnerText = `It's a tie! Both got ${s1} pairs!`;
    } else if (iWon) {
      winnerText = `YOU WON! Congratulations! (${Math.max(s1, s2)} pairs)`;
    } else {
      winnerText = `Your friend won! Good match! (${Math.max(s1, s2)} pairs)`;
    }
  } else {
    if (s1 > s2)       winnerText = `${PLAYER_NAMES[0]} wins with ${s1} pairs!`;
    else if (s2 > s1)  winnerText = `${PLAYER_NAMES[1]} wins with ${s2} pairs!`;
    else               winnerText = `It's a tie! Both players matched ${s1} pairs!`;
  }

  $modalWinner.textContent   = winnerText;
  $modalP1Score.textContent  = `${s1} pts`;
  $modalP2Score.textContent  = `${s2} pts`;
  $modalOverlay.removeAttribute('hidden');

  // Confetti in modal
  const confettiContainer = document.getElementById('modal-confetti');
  confettiContainer.innerHTML = '';
  for (let i = 0; i < 30; i++) {
    const c = document.createElement('div');
    c.style.cssText = `
      position:absolute;
      width:${6+Math.random()*10}px; height:${6+Math.random()*10}px;
      background:${PARTICLE_COLORS[Math.floor(Math.random()*PARTICLE_COLORS.length)]};
      border-radius:${Math.random()>0.5?'50%':'2px'};
      left:${Math.random()*100}%;
      top:${Math.random()*100}%;
      opacity:0.7;
      animation: particle-fly ${0.8+Math.random()*1.5}s ${Math.random()*0.5}s ease-out infinite alternate;
      --tx:${(Math.random()-0.5)*60}px;
      --ty:${(Math.random()-0.5)*60}px;
    `;
    confettiContainer.appendChild(c);
  }
}

/* ══════════════════════════════════════════════════
   RESTART / INIT
   ══════════════════════════════════════════════════ */
function initGame(providedDeck = null) {
  // Reset state
  state.deck          = providedDeck || buildDeck();
  state.flipped       = [];
  state.matched       = new Set();
  state.currentPlayer = 0;
  state.scores        = [0, 0];
  state.locked        = false;
  state.pairsFound    = 0;

  // Hide modal
  $modalOverlay.setAttribute('hidden', '');

  // Clear particles
  $particles.innerHTML = '';

  // Render
  renderBoard();
  updateScoreUI();
  updateTurnUI(false);
}

/* ══════════════════════════════════════════════════
   PEERJS LIVE SERVER MULTIPLAYER SYSTEM
   ══════════════════════════════════════════════════ */
const PEER_PREFIX = 'cardgame-';

function generateRandomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let res = '';
  for (let i = 0; i < 6; i++) {
    res += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return res;
}

function initHostRoom() {
  if (typeof Peer === 'undefined') {
    alert('Multiplayer service (PeerJS) is still loading or unavailable offline. Please check your internet connection.');
    return;
  }
  const code = generateRandomCode();
  state.roomCode = code;
  state.isMultiplayer = true;
  state.isHost = true;
  state.myPlayerIndex = 0;

  showRoomInfoUI(code, true);

  if (state.peer) {
    try { state.peer.destroy(); } catch (_) {}
  }

  const peerId = PEER_PREFIX + code.toUpperCase();
  try {
    state.peer = new Peer(peerId, { debug: 1 });
  } catch (e) {
    alert('Could not initialize room: ' + e.message);
    switchToLocalMode();
    return;
  }

  state.peer.on('open', (id) => {
    $roomStatusText.textContent = 'Room Code: ';
    $roleBadge.textContent = 'Host (P1) — Waiting for friend...';
    $p1Label.textContent = 'You (P1)';
    $p2Label.textContent = 'Friend (P2)';
  });

  state.peer.on('connection', (conn) => {
    state.conn = conn;
    setupConnectionHandlers(conn);

    conn.on('open', () => {
      $roomStatusDot.classList.add('connected');
      $roleBadge.textContent = 'Friend Connected!';
      // Host generates and broadcasts initial shared deck
      const freshDeck = buildDeck();
      initGame(freshDeck);
      conn.send({
        type: 'GAME_INIT',
        deck: freshDeck
      });
    });
  });

  state.peer.on('error', (err) => {
    console.warn('Peer error:', err);
    if (err.type === 'unavailable-id') {
      alert('Room code collision, generating new code...');
      initHostRoom();
    } else {
      alert('Connection error: ' + err.message);
    }
  });
}

function joinGuestRoom(code) {
  if (typeof Peer === 'undefined') {
    alert('Multiplayer service (PeerJS) is still loading or unavailable offline. Please check your internet connection.');
    return;
  }
  const cleanCode = code.trim().toUpperCase();
  if (!cleanCode || cleanCode.length < 3) {
    alert('Please enter a valid room code!');
    return;
  }

  state.roomCode = cleanCode;
  state.isMultiplayer = true;
  state.isHost = false;
  state.myPlayerIndex = 1;

  showRoomInfoUI(cleanCode, false);
  $roleBadge.textContent = 'Connecting to room...';

  if (state.peer) {
    try { state.peer.destroy(); } catch (_) {}
  }

  try {
    state.peer = new Peer({ debug: 1 });
  } catch (e) {
    alert('Could not connect: ' + e.message);
    switchToLocalMode();
    return;
  }

  state.peer.on('open', (myGuestId) => {
    const hostPeerId = PEER_PREFIX + cleanCode;
    const conn = state.peer.connect(hostPeerId, { reliable: true });
    state.conn = conn;
    setupConnectionHandlers(conn);

    conn.on('open', () => {
      $roomStatusDot.classList.add('connected');
      $roomStatusText.textContent = 'Joined: ';
      $roleBadge.textContent = 'Connected (You: P2)';
      $p1Label.textContent = 'Friend (P1)';
      $p2Label.textContent = 'You (P2)';
    });
  });

  state.peer.on('error', (err) => {
    console.warn('Peer error:', err);
    alert('Could not join room. Check the code or try again!');
    switchToLocalMode();
  });
}

function setupConnectionHandlers(conn) {
  conn.on('data', (data) => {
    if (!data || !data.type) return;

    if (data.type === 'GAME_INIT') {
      // Guest receives deck from host
      initGame(data.deck);
    } else if (data.type === 'CARD_FLIP') {
      // Opponent flipped card
      executeCardFlip(data.index);
    } else if (data.type === 'RESTART') {
      initGame(data.deck);
      soundFlip();
    }
  });

  conn.on('close', () => {
    $roomStatusDot.classList.remove('connected');
    $roleBadge.textContent = 'Friend disconnected';
    alert('Opponent disconnected!');
  });
}

function showRoomInfoUI(code, isHost) {
  $roomActions.setAttribute('hidden', '');
  $roomInfo.removeAttribute('hidden');
  $displayRoomCode.textContent = code;
}

function switchToLocalMode() {
  if (state.peer) {
    try { state.peer.destroy(); } catch (_) {}
  }
  state.isMultiplayer = false;
  state.isHost = false;
  state.conn = null;
  state.peer = null;
  state.myPlayerIndex = 0;

  $p1Label.textContent = 'Player 1';
  $p2Label.textContent = 'Player 2';
  $roomInfo.setAttribute('hidden', '');
  $roomActions.removeAttribute('hidden');
  $roomStatusDot.classList.remove('connected');

  initGame();
}

/* ══════════════════════════════════════════════════
   EVENT LISTENERS
   ══════════════════════════════════════════════════ */
$btnCreateRoom.addEventListener('click', () => {
  soundFlip();
  initHostRoom();
});

$btnJoinRoom.addEventListener('click', () => {
  const code = $inputRoomCode.value;
  soundFlip();
  joinGuestRoom(code);
});

$inputRoomCode.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    $btnJoinRoom.click();
  }
});

$btnCopyCode.addEventListener('click', () => {
  if (!state.roomCode) return;
  const url = `${window.location.origin}${window.location.pathname}?room=${state.roomCode}`;
  const originalHtml = $btnCopyCode.innerHTML;
  navigator.clipboard.writeText(url).then(() => {
    $btnCopyCode.textContent = 'Copied!';
    setTimeout(() => { $btnCopyCode.innerHTML = originalHtml; }, 1800);
  }).catch(() => {
    navigator.clipboard.writeText(state.roomCode);
    $btnCopyCode.textContent = 'Copied!';
    setTimeout(() => { $btnCopyCode.innerHTML = originalHtml; }, 1800);
  });
});

$btnLocalMode.addEventListener('click', () => {
  soundFlip();
  switchToLocalMode();
});

const $btnLeaveRoom = document.getElementById('btn-leave-room');
if ($btnLeaveRoom) {
  $btnLeaveRoom.addEventListener('click', () => {
    soundFlip();
    switchToLocalMode();
  });
}

$btnRestart.addEventListener('click', () => {
  soundFlip();
  if (state.isMultiplayer && state.conn && state.conn.open) {
    const freshDeck = buildDeck();
    initGame(freshDeck);
    state.conn.send({ type: 'RESTART', deck: freshDeck });
  } else {
    initGame();
  }
});

$btnPlayAgain.addEventListener('click', () => {
  soundFlip();
  if (state.isMultiplayer && state.conn && state.conn.open) {
    const freshDeck = buildDeck();
    initGame(freshDeck);
    state.conn.send({ type: 'RESTART', deck: freshDeck });
  } else {
    initGame();
  }
});

// Keyboard support for cards
$board.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    const card = e.target.closest('.card');
    if (card) {
      e.preventDefault();
      card.click();
    }
  }
});

// Make cards keyboard-focusable
$board.addEventListener('focus', (e) => {
  const card = e.target.closest('.card');
  if (card && !card.hasAttribute('tabindex')) {
    card.setAttribute('tabindex', '0');
  }
}, true);

/* ══════════════════════════════════════════════════
   DYNAMIC CARD SIZING — fills the board wrapper
   exactly without ever scrolling
   ══════════════════════════════════════════════════ */
const COLS = 13;
const ROWS = 4;
const CARD_GAP = 4;       // px between cards
const CARD_RATIO = 7 / 5; // height : width (standard playing card)

function updateCardSize() {
  const wrapper = document.querySelector('.board-wrapper');
  if (!wrapper) return;

  const availW = wrapper.clientWidth  - 2;
  const availH = wrapper.clientHeight - 2;

  const wFromW = (availW - (COLS - 1) * CARD_GAP) / COLS;
  const wFromH = (availH - (ROWS - 1) * CARD_GAP) / ROWS / CARD_RATIO;

  let cardW = Math.max(28, Math.min(wFromW, wFromH, 110));
  let cardH = Math.round(cardW * CARD_RATIO);
  cardW     = Math.round(cardW);

  const root = document.documentElement;
  root.style.setProperty('--card-w',   `${cardW}px`);
  root.style.setProperty('--card-h',   `${cardH}px`);
  root.style.setProperty('--card-gap', `${CARD_GAP}px`);
}

const _sizeObserver = new ResizeObserver(() => updateCardSize());
_sizeObserver.observe(document.querySelector('.board-wrapper'));

/* ══════════════════════════════════════════════════
   BOOT & URL ROOM CHECK
   ══════════════════════════════════════════════════ */
updateCardSize();
initGame();

// Check if URL has ?room=CODE or ?action=create
const urlParams = new URLSearchParams(window.location.search);
const roomParam = urlParams.get('room');
const actionParam = urlParams.get('action');

if (roomParam) {
  $inputRoomCode.value = roomParam;
  // Automatically join if room query param is present
  setTimeout(() => {
    joinGuestRoom(roomParam);
  }, 400);
} else if (actionParam === 'create') {
  // Automatically launch room creator if clicked from landing page
  setTimeout(() => {
    initHostRoom();
  }, 350);
}


