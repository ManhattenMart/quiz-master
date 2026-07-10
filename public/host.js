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
  renderMedia(q.media, q.roundType);

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

function renderMedia(media, roundType) {
  const box = el('media-box');
  box.innerHTML = '';
  if (!media) {
    box.style.display = 'none';
    return;
  }
  box.style.display = '';

  // Music rounds hide the title/artist by default on the host screen too —
  // if you're screen-sharing during the call, anyone watching would otherwise
  // see the answer on your shared screen even though players' own screens hide
  // it. A "Peek" button lets you glance at it privately if you need to confirm
  // the right clip loaded; click it again to hide.
  const blind = roundType === 'music';
  const mediaWrap = document.createElement('div');

  let mediaEl = null;
  if (media.type === 'youtube') {
    const id = extractYouTubeId(media.url);
    const start = media.start || 0;
    mediaEl = document.createElement('iframe');
    mediaEl.width = '100%';
    mediaEl.height = '400';
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
    mediaEl.height = '400';
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

  if (mediaEl) mediaWrap.appendChild(mediaEl);

  if (!blind) {
    box.appendChild(mediaWrap);
    return;
  }

  // Blind (music round): keep the real player off-screen but playing, show a
  // placeholder plus a Peek toggle instead.
  mediaWrap.style.position = 'absolute';
  mediaWrap.style.width = '1px';
  mediaWrap.style.height = '1px';
  mediaWrap.style.overflow = 'hidden';
  mediaWrap.style.opacity = '0.01';
  box.appendChild(mediaWrap);

  const placeholder = document.createElement('div');
  placeholder.className = 'now-playing';
  placeholder.innerHTML = `
    <div class="eq"><span></span><span></span><span></span><span></span></div>
    <div class="muted" style="margin-top:12px;">Hidden from your screen too — playing for everyone</div>
    <button class="ghost small" style="margin-top:14px;" id="btn-peek-media">Peek (only if you're not sharing this)</button>`;
  box.appendChild(placeholder);

  placeholder.querySelector('#btn-peek-media').addEventListener('click', () => {
    const revealed = mediaWrap.style.opacity !== '1';
    if (revealed) {
      mediaWrap.style.position = '';
      mediaWrap.style.width = '';
      mediaWrap.style.height = '';
      mediaWrap.style.overflow = '';
      mediaWrap.style.opacity = '1';
      placeholder.style.display = 'none';
    } else {
      mediaWrap.style.position = 'absolute';
      mediaWrap.style.width = '1px';
      mediaWrap.style.height = '1px';
      mediaWrap.style.overflow = 'hidden';
      mediaWrap.style.opacity = '0.01';
      placeholder.style.display = '';
    }
  });
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
