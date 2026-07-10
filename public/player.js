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
  renderMedia(q.media);

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

function renderMedia(media) {
  const box = el('p-media-box');
  box.innerHTML = '';
  if (!media) {
    box.style.display = 'none';
    return;
  }
  box.style.display = '';
  if (media.type === 'youtube') {
    const id = extractYouTubeId(media.url);
    const start = media.start || 0;
    const iframe = document.createElement('iframe');
    iframe.width = '100%';
    iframe.height = '220';
    iframe.src = `https://www.youtube.com/embed/${id}?start=${start}&autoplay=1`;
    iframe.frameBorder = '0';
    iframe.allow = 'autoplay; encrypted-media';
    iframe.allowFullscreen = true;
    box.appendChild(iframe);
  } else if (media.type === 'spotify') {
    const iframe = document.createElement('iframe');
    iframe.width = '100%';
    iframe.height = '152';
    iframe.src = extractSpotifyEmbedUrl(media.url);
    iframe.frameBorder = '0';
    iframe.allow = 'autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture';
    box.appendChild(iframe);
  } else if (media.type === 'amazon') {
    const iframe = document.createElement('iframe');
    iframe.width = '100%';
    iframe.height = '300';
    iframe.src = media.url;
    iframe.frameBorder = '0';
    iframe.style.border = '1px solid rgba(0,0,0,0.12)';
    box.appendChild(iframe);
  } else if (media.type === 'audio') {
    const audio = document.createElement('audio');
    audio.src = media.url;
    audio.controls = true;
    audio.autoplay = true;
    box.appendChild(audio);
  } else if (media.type === 'video') {
    const video = document.createElement('video');
    video.src = media.url;
    video.controls = true;
    video.autoplay = true;
    box.appendChild(video);
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
