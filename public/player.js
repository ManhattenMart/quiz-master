const socket = io();

const el = (id) => document.getElementById(id);
const screens = ['screen-join', 'screen-waiting', 'screen-question', 'screen-reveal', 'screen-leaderboard', 'screen-over'];
function showScreen(id) {
  screens.forEach((s) => (el(s).style.display = s === id ? '' : 'none'));
}

let gameCode = null;
let playerId = localStorage.getItem('qm_playerId') || null;
let myScore = 0;
let hasAnsweredCurrent = false;
let timerInterval = null;
let currentQuestionType = null;

// Pre-fill code from URL (?code=ABCD)
const params = new URLSearchParams(location.search);
if (params.get('code')) el('input-code').value = params.get('code').toUpperCase();
const savedName = localStorage.getItem('qm_name');
if (savedName) el('input-name').value = savedName;

el('btn-join').addEventListener('click', joinGame);
el('input-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') joinGame(); });
el('input-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') joinGame(); });

function joinGame() {
  const code = el('input-code').value.trim().toUpperCase();
  const name = el('input-name').value.trim();
  if (!code || !name) {
    el('join-error').textContent = 'Enter both a game code and your name.';
    return;
  }
  socket.emit('player:join', { code, name, playerId }, (res) => {
    if (!res.ok) {
      el('join-error').textContent = res.error;
      return;
    }
    gameCode = code;
    playerId = res.playerId;
    localStorage.setItem('qm_playerId', playerId);
    localStorage.setItem('qm_name', name);
    myScore = (res.players.find((p) => p.id === playerId) || {}).score || 0;

    if (res.state === 'question' && res.question && !res.alreadyAnswered) {
      renderQuestion(res.question);
    } else if (res.state === 'gameover') {
      showScreen('screen-over');
    } else {
      el('waiting-title').textContent = `You're in, ${name}!`;
      updateScorePill('my-score-pill', myScore);
      showScreen('screen-waiting');
    }
  });
}

function updateScorePill(id, score) {
  el(id).textContent = `${score} point${score === 1 ? '' : 's'}`;
}

// ---------- Question ----------

socket.on('state:question', (q) => {
  renderQuestion(q);
});

function renderQuestion(q) {
  hasAnsweredCurrent = false;
  currentQuestionType = q.type;
  showScreen('screen-question');
  el('p-round-pill').textContent = q.roundName;
  el('p-progress-pill').textContent = `Q${q.questionNumber}/${q.totalQuestions}`;
  updateScorePill('p-score-pill', myScore);
  el('p-q-text').textContent = q.text;
  el('p-status').textContent = '';
  renderMedia(q.media, q.roundType);

  const grid = el('p-options-grid');
  grid.innerHTML = '';
  const textWrap = el('p-text-answer-wrap');

  if (q.type === 'mc' && q.options) {
    textWrap.style.display = 'none';
    grid.style.display = '';
    q.options.forEach((opt, idx) => {
      const b = document.createElement('button');
      b.className = 'option-btn';
      b.textContent = opt;
      b.addEventListener('click', () => submitAnswer(idx, b));
      grid.appendChild(b);
    });
  } else {
    grid.style.display = 'none';
    textWrap.style.display = '';
    el('p-text-answer').value = '';
    el('p-text-answer').disabled = false;
    el('p-submit-text').disabled = false;
  }

  startTimerBar(q.timeLimit, q.startedAt);
}

function startTimerBar(timeLimit, startedAt) {
  clearInterval(timerInterval);
  const fill = el('p-timer-fill');
  fill.style.width = '100%';
  timerInterval = setInterval(() => {
    const elapsed = (Date.now() - startedAt) / 1000;
    const pct = Math.max(0, 100 - (elapsed / timeLimit) * 100);
    fill.style.width = pct + '%';
    if (pct <= 0) clearInterval(timerInterval);
  }, 100);
}

function renderMedia(media, roundType) {
  const box = el('p-media-box');
  box.innerHTML = '';
  if (!media) {
    box.style.display = 'none';
    return;
  }
  box.style.display = '';

  // On music rounds, players should hear the clip but never see the track
  // title/artist — Spotify and Amazon Music widgets show that text as part
  // of their UI, and YouTube can reveal it on pause. So the real player is
  // rendered off-screen (still playing audio) and a blind "now playing"
  // animation is shown instead. Film rounds keep the visual clip, since
  // seeing it is the point.
  const blind = roundType === 'music';
  const playerHolder = document.createElement('div');
  if (blind) {
    playerHolder.style.position = 'absolute';
    playerHolder.style.width = '1px';
    playerHolder.style.height = '1px';
    playerHolder.style.overflow = 'hidden';
    playerHolder.style.opacity = '0.01';
  }

  let mediaEl = null;
  if (media.type === 'youtube') {
    const id = extractYouTubeId(media.url);
    const start = media.start || 0;
    mediaEl = document.createElement('iframe');
    mediaEl.width = '100%';
    mediaEl.height = '220';
    mediaEl.src = `https://www.youtube.com/embed/${id}?start=${start}&autoplay=1`;
    mediaEl.frameBorder = '0';
    mediaEl.allow = 'autoplay; encrypted-media';
    mediaEl.allowFullscreen = true;
  } else if (media.type === 'spotify') {
    mediaEl = document.createElement('iframe');
    mediaEl.width = '100%';
    mediaEl.height = '152';
    mediaEl.src = extractSpotifyEmbedUrl(media.url);
    mediaEl.frameBorder = '0';
    mediaEl.allow = 'autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture';
  } else if (media.type === 'amazon') {
    mediaEl = document.createElement('iframe');
    mediaEl.width = '100%';
    mediaEl.height = '300';
    mediaEl.src = media.url;
    mediaEl.frameBorder = '0';
    mediaEl.style.border = '1px solid rgba(0,0,0,0.12)';
  } else if (media.type === 'audio') {
    mediaEl = document.createElement('audio');
    mediaEl.src = media.url;
    mediaEl.controls = !blind;
    mediaEl.autoplay = true;
  } else if (media.type === 'video') {
    mediaEl = document.createElement('video');
    mediaEl.src = media.url;
    mediaEl.controls = true;
    mediaEl.autoplay = true;
    mediaEl.width = '100%';
  }

  if (mediaEl) playerHolder.appendChild(mediaEl);
  box.appendChild(playerHolder);

  if (blind) {
    const placeholder = document.createElement('div');
    placeholder.className = 'now-playing';
    placeholder.innerHTML = `
      <div class="eq"><span></span><span></span><span></span><span></span></div>
      <div class="muted" style="margin-top:12px;">Listen carefully…</div>`;
    box.appendChild(placeholder);
  }
}

function extractYouTubeId(url) {
  const m = url.match(/(?:v=|youtu\.be\/|embed\/)([A-Za-z0-9_-]{6,})/);
  return m ? m[1] : url;
}

function extractSpotifyEmbedUrl(url) {
  if (!url) return '';
  if (url.includes('/embed/')) return url.split('?')[0];
  const m = url.match(/open\.spotify\.com\/(track|album|playlist|episode|show)\/([A-Za-z0-9]+)/);
  if (m) return `https://open.spotify.com/embed/${m[1]}/${m[2]}`;
  return url;
}

function submitAnswer(answer, btnEl) {
  if (hasAnsweredCurrent) return;
  hasAnsweredCurrent = true;
  if (btnEl) {
    Array.from(el('p-options-grid').children).forEach((b) => (b.disabled = true));
    btnEl.classList.add('picked');
  }
  socket.emit('player:submitAnswer', { code: gameCode, answer }, (res) => {
    el('p-status').textContent = res && res.ok ? 'Answer locked in!' : (res && res.error) || 'Could not submit';
  });
}

el('p-submit-text').addEventListener('click', () => {
  const val = el('p-text-answer').value.trim();
  if (!val) return;
  el('p-text-answer').disabled = true;
  el('p-submit-text').disabled = true;
  submitAnswer(val, null);
});

socket.on('state:locked', () => {
  clearInterval(timerInterval);
  if (!hasAnsweredCurrent) {
    el('p-status').textContent = "Time's up!";
    Array.from(el('p-options-grid').children).forEach((b) => (b.disabled = true));
    el('p-text-answer').disabled = true;
    el('p-submit-text').disabled = true;
  }
});

socket.on('state:reveal', ({ correctOptionIndex, correctAnswer, results }) => {
  const mine = results.find((r) => r.playerId === playerId);
  if (currentQuestionType === 'mc' && correctOptionIndex !== null && correctOptionIndex >= 0) {
    const buttons = el('p-options-grid').children;
    if (buttons[correctOptionIndex]) buttons[correctOptionIndex].classList.add('correct');
  }

  if (mine) {
    myScore = mine.score;
    el('reveal-heading').textContent = mine.answered
      ? (mine.isCorrect ? '✅ Correct!' : '❌ Not quite')
      : '⏱️ No answer submitted';
    el('reveal-points').textContent = mine.isCorrect
      ? `+${mine.pointsAwarded} points — correct answer was "${correctAnswer}"`
      : `Correct answer: ${correctAnswer}`;
    updateScorePill('reveal-score-pill', myScore);
  }
  showScreen('screen-reveal');
});

socket.on('state:leaderboard', ({ players }) => {
  renderPlayerList('board-players', players);
  showScreen('screen-leaderboard');
});

socket.on('state:gameover', ({ players }) => {
  renderPlayerList('final-players', players);
  showScreen('screen-over');
});

socket.on('players:update', (players) => {
  const mine = players.find((p) => p.id === playerId);
  if (mine) myScore = mine.score;
});

function renderPlayerList(elementId, players) {
  const list = el(elementId);
  list.innerHTML = '';
  players.forEach((p, i) => {
    const li = document.createElement('li');
    if (p.id === playerId) li.style.outline = '2px solid var(--accent-2)';
    li.innerHTML = `<span><span class="rank">#${i + 1}</span> ${escapeHtml(p.name)}</span><strong>${p.score}</strong>`;
    list.appendChild(li);
  });
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
