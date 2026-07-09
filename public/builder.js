const el = (id) => document.getElementById(id);

let quizState = null; // { title, rounds: [ { name, type, questions: [...] } ] }
let currentFile = null; // filename being edited, or null for a brand new quiz

// ---------- List view ----------

function loadQuizList() {
  fetch('/api/quizzes')
    .then((r) => r.json())
    .then((quizzes) => {
      const container = el('quiz-list');
      container.innerHTML = '';
      if (quizzes.length === 0) {
        container.innerHTML = '<p class="muted">No quizzes yet — click "New Quiz" to build your first one.</p>';
        return;
      }
      quizzes.forEach((q) => {
        const row = document.createElement('div');
        row.className = 'list-item';
        row.innerHTML = `
          <div>
            <strong>${escapeHtml(q.title)}</strong>
            <div class="muted small">${q.rounds} rounds, ${q.questions} questions</div>
          </div>
          <div>
            <button class="secondary" data-edit="${q.file}">Edit</button>
            <button class="icon-btn" title="Delete" data-delete="${q.file}">🗑</button>
          </div>`;
        container.appendChild(row);
      });
      container.querySelectorAll('[data-edit]').forEach((b) =>
        b.addEventListener('click', () => openEditor(b.dataset.edit)));
      container.querySelectorAll('[data-delete]').forEach((b) =>
        b.addEventListener('click', () => deleteQuiz(b.dataset.delete)));
    });
}

function deleteQuiz(file) {
  if (!confirm('Delete this quiz? This cannot be undone.')) return;
  fetch(`/api/quizzes/${encodeURIComponent(file)}`, { method: 'DELETE' })
    .then((r) => r.json())
    .then(() => loadQuizList());
}

el('btn-new-quiz').addEventListener('click', () => {
  currentFile = null;
  quizState = { title: '', rounds: [] };
  showEditor();
});

el('btn-back-to-list').addEventListener('click', () => {
  el('view-editor').style.display = 'none';
  el('view-list').style.display = '';
  loadQuizList();
});

function openEditor(file) {
  fetch(`/api/quizzes/${encodeURIComponent(file)}`)
    .then((r) => r.json())
    .then((data) => {
      if (data.error) { alert(data.error); return; }
      currentFile = data.file;
      quizState = data.quiz;
      normalizeForEditing(quizState);
      showEditor();
    });
}

function showEditor() {
  el('view-list').style.display = 'none';
  el('view-editor').style.display = '';
  el('quiz-title').value = quizState.title || '';
  el('save-status').textContent = '';
  renderRounds();
}

el('quiz-title').addEventListener('input', (e) => { quizState.title = e.target.value; });

// ---------- Rounds & questions ----------

function normalizeForEditing(quiz) {
  (quiz.rounds || []).forEach((round) => {
    (round.questions || []).forEach((q) => {
      if (Array.isArray(q.acceptedAnswers)) q.acceptedAnswers = q.acceptedAnswers.join(', ');
      if (q.acceptedAnswers == null) q.acceptedAnswers = '';
    });
  });
}

function blankQuestion(roundType) {
  const base = { type: 'mc', text: '', options: ['', ''], correctAnswer: '', acceptedAnswers: '', points: 1000, timeLimit: 20 };
  if (roundType === 'music' || roundType === 'film') {
    base.media = { type: 'youtube', url: '', start: 0 };
  }
  return base;
}

el('btn-add-round').addEventListener('click', () => {
  quizState.rounds.push({ name: `Round ${quizState.rounds.length + 1}`, type: 'standard', questions: [] });
  renderRounds();
});

function renderRounds() {
  const container = el('rounds-container');
  container.innerHTML = '';

  quizState.rounds.forEach((round, ri) => {
    const card = document.createElement('div');
    card.className = 'round-card';

    const header = document.createElement('div');
    header.className = 'row between';
    header.innerHTML = `
      <div style="flex:1; display:flex; gap:10px;">
        <input data-round-name style="flex:1;" placeholder="Round name" value="${escapeAttr(round.name)}" />
        <select data-round-type>
          <option value="standard" ${round.type === 'standard' ? 'selected' : ''}>Standard</option>
          <option value="music" ${round.type === 'music' ? 'selected' : ''}>🎵 Music</option>
          <option value="film" ${round.type === 'film' ? 'selected' : ''}>🎬 Film</option>
        </select>
      </div>
      <button class="icon-btn" title="Delete round">🗑</button>`;
    header.querySelector('[data-round-name]').addEventListener('input', (e) => { round.name = e.target.value; });
    header.querySelector('[data-round-type]').addEventListener('change', (e) => {
      round.type = e.target.value;
      round.questions.forEach((q) => {
        if (round.type === 'music' || round.type === 'film') {
          if (!q.media) q.media = { type: 'youtube', url: '', start: 0 };
        } else {
          delete q.media;
        }
      });
      renderRounds();
    });
    header.querySelector('.icon-btn').addEventListener('click', () => {
      if (!confirm('Remove this round and all its questions?')) return;
      quizState.rounds.splice(ri, 1);
      renderRounds();
    });
    card.appendChild(header);

    round.questions.forEach((q, qi) => card.appendChild(renderQuestion(round, ri, q, qi)));

    const addQBtn = document.createElement('button');
    addQBtn.className = 'secondary';
    addQBtn.style.marginTop = '12px';
    addQBtn.textContent = '+ Add Question';
    addQBtn.addEventListener('click', () => {
      round.questions.push(blankQuestion(round.type));
      renderRounds();
    });
    card.appendChild(addQBtn);

    container.appendChild(card);
  });
}

function renderQuestion(round, ri, q, qi) {
  const card = document.createElement('div');
  card.className = 'question-card';

  const top = document.createElement('div');
  top.className = 'row between';
  top.innerHTML = `
    <strong>Q${qi + 1}</strong>
    <div>
      <select data-q-type>
        <option value="mc" ${q.type === 'mc' ? 'selected' : ''}>Multiple choice</option>
        <option value="text" ${q.type === 'text' ? 'selected' : ''}>Type-in answer</option>
      </select>
      <button class="icon-btn" title="Delete question">🗑</button>
    </div>`;
  top.querySelector('[data-q-type]').addEventListener('change', (e) => {
    q.type = e.target.value;
    if (q.type === 'mc' && (!q.options || q.options.length < 2)) q.options = ['', ''];
    renderRounds();
  });
  top.querySelector('.icon-btn').addEventListener('click', () => {
    round.questions.splice(qi, 1);
    renderRounds();
  });
  card.appendChild(top);

  const textField = document.createElement('div');
  textField.className = 'field';
  textField.innerHTML = `<label class="field-label">Question</label><input style="width:100%;" placeholder="What is..." value="${escapeAttr(q.text)}" />`;
  textField.querySelector('input').addEventListener('input', (e) => { q.text = e.target.value; });
  card.appendChild(textField);

  if (q.type === 'mc') {
    const optWrap = document.createElement('div');
    optWrap.className = 'field';
    optWrap.innerHTML = `<label class="field-label">Options (select the correct one)</label>`;
    q.options.forEach((opt, oi) => {
      const row = document.createElement('div');
      row.className = 'option-row';
      row.innerHTML = `
        <input type="radio" name="correct-${ri}-${qi}" ${q.correctAnswer === opt && opt !== '' ? 'checked' : ''} />
        <input style="flex:1;" placeholder="Option ${oi + 1}" value="${escapeAttr(opt)}" />
        ${q.options.length > 2 ? '<button class="icon-btn" title="Remove option">✕</button>' : ''}`;
      const [radio, input] = row.querySelectorAll('input');
      radio.addEventListener('change', () => { q.correctAnswer = q.options[oi]; });
      input.addEventListener('input', (e) => {
        const wasCorrect = q.correctAnswer === q.options[oi];
        q.options[oi] = e.target.value;
        if (wasCorrect) q.correctAnswer = e.target.value;
      });
      const removeBtn = row.querySelector('.icon-btn');
      if (removeBtn) removeBtn.addEventListener('click', () => {
        q.options.splice(oi, 1);
        renderRounds();
      });
      optWrap.appendChild(row);
    });
    const addOptBtn = document.createElement('button');
    addOptBtn.className = 'ghost';
    addOptBtn.textContent = '+ Add option';
    addOptBtn.addEventListener('click', () => { q.options.push(''); renderRounds(); });
    optWrap.appendChild(addOptBtn);
    card.appendChild(optWrap);
  } else {
    const ansField = document.createElement('div');
    ansField.className = 'field';
    ansField.innerHTML = `
      <label class="field-label">Correct answer</label>
      <input style="width:100%; margin-bottom:8px;" placeholder="e.g. Jupiter" value="${escapeAttr(q.correctAnswer)}" />
      <label class="field-label">Other accepted answers (comma-separated, optional)</label>
      <input style="width:100%;" placeholder="e.g. the red planet, mars" value="${escapeAttr(q.acceptedAnswers)}" />`;
    const [ansInput, altInput] = ansField.querySelectorAll('input');
    ansInput.addEventListener('input', (e) => { q.correctAnswer = e.target.value; });
    altInput.addEventListener('input', (e) => { q.acceptedAnswers = e.target.value; });
    card.appendChild(ansField);
  }

  if (round.type === 'music' || round.type === 'film') {
    if (!q.media) q.media = { type: 'youtube', url: '', start: 0 };
    const mediaField = document.createElement('div');
    mediaField.className = 'field';
    const label = round.type === 'music' ? 'Song clip' : 'Film clip';
    mediaField.innerHTML = `
      <label class="field-label">${label} — paste a YouTube link, or a direct audio/video file URL</label>
      <div class="row">
        <select data-media-type style="width:120px;">
          <option value="youtube" ${q.media.type === 'youtube' ? 'selected' : ''}>YouTube</option>
          <option value="audio" ${q.media.type === 'audio' ? 'selected' : ''}>Audio file</option>
          <option value="video" ${q.media.type === 'video' ? 'selected' : ''}>Video file</option>
        </select>
        <input data-media-url style="flex:1;" placeholder="https://..." value="${escapeAttr(q.media.url)}" />
        ${q.media.type === 'youtube' ? `<input data-media-start type="number" min="0" style="width:90px;" placeholder="Start (s)" value="${q.media.start || 0}" />` : ''}
      </div>`;
    mediaField.querySelector('[data-media-type]').addEventListener('change', (e) => { q.media.type = e.target.value; renderRounds(); });
    mediaField.querySelector('[data-media-url]').addEventListener('input', (e) => { q.media.url = e.target.value; });
    const startInput = mediaField.querySelector('[data-media-start]');
    if (startInput) startInput.addEventListener('input', (e) => { q.media.start = Number(e.target.value) || 0; });
    card.appendChild(mediaField);
  }

  const metaField = document.createElement('div');
  metaField.className = 'row';
  metaField.innerHTML = `
    <div class="field" style="width:140px;">
      <label class="field-label">Points</label>
      <input type="number" min="0" step="50" value="${q.points}" />
    </div>
    <div class="field" style="width:140px;">
      <label class="field-label">Time limit (sec)</label>
      <input type="number" min="5" step="5" value="${q.timeLimit}" />
    </div>`;
  const [ptsInput, timeInput] = metaField.querySelectorAll('input');
  ptsInput.addEventListener('input', (e) => { q.points = Number(e.target.value) || 0; });
  timeInput.addEventListener('input', (e) => { q.timeLimit = Number(e.target.value) || 0; });
  card.appendChild(metaField);

  return card;
}

// ---------- Save ----------

el('btn-save-quiz').addEventListener('click', () => {
  const status = el('save-status');
  status.textContent = 'Saving...';

  const cleaned = JSON.parse(JSON.stringify(quizState));
  cleaned.rounds.forEach((round) => {
    round.questions.forEach((q) => {
      if (q.type === 'text' && typeof q.acceptedAnswers === 'string') {
        q.acceptedAnswers = q.acceptedAnswers.split(',').map((s) => s.trim()).filter(Boolean);
      }
      if (q.media && !q.media.url) delete q.media;
    });
  });

  if (!cleaned.title || !cleaned.title.trim()) {
    status.textContent = 'Give your quiz a title first.';
    return;
  }
  if (cleaned.rounds.length === 0) {
    status.textContent = 'Add at least one round.';
    return;
  }

  fetch('/api/quizzes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename: currentFile, quiz: cleaned }),
  })
    .then((r) => r.json())
    .then((res) => {
      if (!res.ok) {
        status.textContent = 'Error: ' + res.error;
        return;
      }
      currentFile = res.file;
      status.textContent = 'Saved! Ready to play from the Host page.';
    })
    .catch((e) => { status.textContent = 'Error: ' + e.message; });
});

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
function escapeAttr(str) {
  return escapeHtml(str == null ? '' : str);
}

loadQuizList();
