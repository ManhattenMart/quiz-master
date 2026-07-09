const socket = io();

const el = (id) => document.getElementById(id);
const show = (id) => { el(id).style.display = ''; };
const hide = (id) => { el(id).style.display = 'none'; };
const screens = ['screen-setup', 'screen-lobby', 'screen-game', 'screen-leaderboard', 'screen-over'];
function showScreen(id) {
  screens.forEach((s) => (el(s).style.display = s === id ? '' : 'none'));
}

let gameCode = null;
let timerInterval = null;

// ---------- Setup ----------

fetch('/api/quizzes')
  .then((r) => r.json())
  .then((quizzes) => {
    const sel = el('quiz-select');
    sel.innerHTML = '';
    quizzes.forEach((q) => {
      const opt = document.createElement('option');
      opt.value = q.file;
      opt.textContent = `${q.title} — ${q.rounds} rounds, ${q.questions} questions`;
      if (q.invalid) opt.disabled = true;
      sel.appendChild(opt);
    });
    if (quizzes.length === 0) {
      el('quiz-summary').textContent = 'No quizzes found in /quizzes. Add a .json file and refresh.';
    }
  });

el('btn-create').addEventListener('click', () => {
  const quizFile = el('quiz-select').value;
  if (!quizFile) return;
  socket.emit('host:createGame', { quizFile }, (res) => {
    if (!res.ok) {
      alert(res.error);
      return;
    }
    gameCode = res.code;
    el('game-code').textContent = gameCode;
    el('lobby-quiz-title').textContent = res.title;
    const url = `${location.origin}/player.html?code=${gameCode}`;
    el('player-url').textContent = url;
    showScreen('screen-lobby');
  });
});

el('btn-start').addEventListener('click', () => {
  socket.emit('host:startGame', { code: gameCode });
});

// ---------- Players / lobby ----------

socket.on('players:update', (players) => {
  renderPlayerList('lobby-players', players);
  renderPlayerList('game-players', players);
  el('lobby-count').textContent = `${players.length} player${players.length === 1 ? '' : 's'}`;
  el('btn-start').disabled = players.length === 0;
});

function renderPlayerList(elementId, players) {
  const list = el(elementId);
  if (!list) return;
  list.innerHTML = '';
  players.forEach((p, i) => {
    const li = document.createElement('li');
    if (!p.connected) li.classList.add('disconnected');
    li.innerHTML = `<span><span class="rank">#${i + 1}</span> ${escapeHtml(p.name)}</span><strong>${p.score}</strong>`;
    list.appendChild(li);
  });
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// ---------- Question flow ----------

socket.on('state:question', (q) => {
  showScreen('screen-game');
  el('round-pill').textContent = q.roundName;
  el('progress-pill').textContent = `Q${q.questionNumber}/${q.totalQuestions}`;
  el('answer-count-pill').textContent = `0 answered`;
  el('q-text').textContent = q.text;
  renderMedia(q.media);

  const grid = el('options-grid');
  grid.innerHTML = '';
  if (q.type === 'mc' && q.options) {
    q.options.forEach((opt) => {
      const b = document.createElement('div');
      b.className = 'option-btn card';
      b.style.background = 'var(--panel-2)';
      b.textContent = opt;
      grid.appendChild(b);
    });
  } else {
    const hint = document.createElement('div');
    hint.className = 'muted';
    hint.textContent = 'Players type their answer — you\'ll mark correctness on reveal.';
    grid.appendChild(hint);
  }

  show('btn-lock');
  el('btn-lock').disabled = false;
  el('btn-reveal').textContent = 'Reveal Answer';
  el('btn-reveal').disabled = false;
  hide('btn-next');

  startTimerBar(q.timeLimit, q.startedAt);
});

function startTimerBar(timeLimit, startedAt) {
  clearInterval(timerInterval);
  const fill = el('timer-fill');
  fill.style.width = '100%';
  timerInterval = setInterval(() => {
    const elapsed = (Date.now() - startedAt) / 1000;
    const pct = Math.max(0, 100 - (elapsed / timeLimit) * 100);
    fill.style.width = pct + '%';
    if (pct <= 0) clearInterval(timerInterval);
  }, 100);
}

function renderMedia(media) {
  const box = el('media-box');
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
    iframe.height = '400';
    iframe.src = `https://www.youtube.com/embed/${id}?start=${start}&autoplay=1`;
    iframe.frameBorder = '0';
    iframe.allow = 'autoplay; encrypted-media';
    iframe.allowFullscreen = true;
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

socket.on('host:answerCount', ({ count, total }) => {
  el('answer-count-pill').textContent = `${count}/${total} answered`;
});

el('btn-lock').addEventListener('click', () => {
  socket.emit('host:lockAnswers', { code: gameCode });
});

socket.on('state:locked', () => {
  clearInterval(timerInterval);
  el('timer-fill').style.width = '0%';
  hide('btn-lock');
});

el('btn-reveal').addEventListener('click', () => {
  socket.emit('host:revealAnswer', { code: gameCode });
});

socket.on('state:reveal', ({ correctOptionIndex, correctAnswer, results, players }) => {
  hide('btn-lock');
  el('btn-reveal').disabled = true;

  if (correctOptionIndex !== null && correctOptionIndex >= 0) {
    const buttons = el('options-grid').children;
    if (buttons[correctOptionIndex]) buttons[correctOptionIndex].classList.add('correct');
  } else {
    const hint = document.createElement('div');
    hint.className = 'pill badge-correct';
    hint.style.marginTop = '10px';
    hint.textContent = `Correct answer: ${correctAnswer}`;
    el('options-grid').appendChild(hint);
  }

  renderPlayerList('game-players', players);
  show('btn-next');
});

el('btn-next').addEventListener('click', () => {
  socket.emit('host:next', { code: gameCode });
});

el('btn-continue').addEventListener('click', () => {
  socket.emit('host:next', { code: gameCode });
});

socket.on('state:leaderboard', ({ players }) => {
  showScreen('screen-leaderboard');
  renderPlayerList('board-players', players);
});

socket.on('state:gameover', ({ players }) => {
  showScreen('screen-over');
  renderPlayerList('final-players', players);
});
