// Quiz Master server
// Express serves the host + player pages; Socket.io drives the live game state.

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const QUIZ_DIR = path.join(__dirname, 'quizzes');

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ---------- Quiz library ----------

function listQuizFiles() {
  return fs
    .readdirSync(QUIZ_DIR)
    .filter((f) => f.endsWith('.json'));
}

function loadQuiz(filename) {
  const safe = path.basename(filename); // prevent path traversal
  const full = path.join(QUIZ_DIR, safe);
  if (!fs.existsSync(full)) throw new Error('Quiz not found');
  const raw = fs.readFileSync(full, 'utf8');
  const quiz = JSON.parse(raw);
  validateQuiz(quiz);
  return quiz;
}

function validateQuiz(quiz) {
  if (!quiz.title || !Array.isArray(quiz.rounds) || quiz.rounds.length === 0) {
    throw new Error('Quiz must have a title and at least one round');
  }
  quiz.rounds.forEach((round, ri) => {
    if (!round.name || !Array.isArray(round.questions) || round.questions.length === 0) {
      throw new Error(`Round ${ri + 1} needs a name and at least one question`);
    }
    round.questions.forEach((q, qi) => {
      if (!q.text || !q.correctAnswer || !q.points || !q.timeLimit) {
        throw new Error(`Round ${ri + 1}, question ${qi + 1} is missing required fields`);
      }
      if (q.type === 'mc' && (!Array.isArray(q.options) || q.options.length < 2)) {
        throw new Error(`Round ${ri + 1}, question ${qi + 1} needs at least 2 options for a multiple-choice question`);
      }
    });
  });
}

app.get('/api/quizzes', (req, res) => {
  try {
    const files = listQuizFiles();
    const summaries = files.map((f) => {
      try {
        const quiz = loadQuiz(f);
        const totalQuestions = quiz.rounds.reduce((n, r) => n + r.questions.length, 0);
        return { file: f, title: quiz.title, rounds: quiz.rounds.length, questions: totalQuestions };
      } catch (e) {
        return { file: f, title: `${f} (invalid: ${e.message})`, rounds: 0, questions: 0, invalid: true };
      }
    });
    res.json(summaries);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Fetch the full contents of one quiz file, for editing in the builder.
app.get('/api/quizzes/:file', (req, res) => {
  try {
    const quiz = loadQuiz(req.params.file);
    res.json({ file: path.basename(req.params.file), quiz });
  } catch (e) {
    res.status(404).json({ error: e.message });
  }
});

function slugify(title) {
  const slug = String(title)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return (slug || 'quiz') + '.json';
}

// Create or update a quiz from the in-app builder. Body: { filename?, quiz }
app.post('/api/quizzes', (req, res) => {
  try {
    const { quiz } = req.body;
    if (!quiz) throw new Error('Missing quiz data');
    validateQuiz(quiz);

    let filename = req.body.filename ? path.basename(req.body.filename) : slugify(quiz.title);
    if (!filename.endsWith('.json')) filename += '.json';

    if (!fs.existsSync(QUIZ_DIR)) fs.mkdirSync(QUIZ_DIR, { recursive: true });
    fs.writeFileSync(path.join(QUIZ_DIR, filename), JSON.stringify(quiz, null, 2));
    res.json({ ok: true, file: filename });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

// Delete a quiz file.
app.delete('/api/quizzes/:file', (req, res) => {
  try {
    const safe = path.basename(req.params.file);
    const full = path.join(QUIZ_DIR, safe);
    if (!fs.existsSync(full)) throw new Error('Quiz not found');
    fs.unlinkSync(full);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

// ---------- Game state ----------

/** @type {Map<string, Game>} */
const games = new Map();

function makeGameCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I confusion
  let code;
  do {
    code = Array.from({ length: 4 }, () => alphabet[crypto.randomInt(alphabet.length)]).join('');
  } while (games.has(code));
  return code;
}

function normalizeAnswer(str) {
  return String(str)
    .toLowerCase()
    .trim()
    .replace(/^(the|a|an)\s+/, '')
    .replace(/[^a-z0-9]/g, '');
}

function flatQuestionList(quiz) {
  // Returns [{roundIndex, questionIndex, round, question}] in play order
  const list = [];
  quiz.rounds.forEach((round, ri) => {
    round.questions.forEach((question, qi) => {
      list.push({ roundIndex: ri, questionIndex: qi, round, question });
    });
  });
  return list;
}

class Game {
  constructor(code, quiz, hostSocketId) {
    this.code = code;
    this.quiz = quiz;
    this.hostSocketId = hostSocketId;
    this.players = new Map(); // playerId -> {id, name, score, connected, socketId}
    this.flatQuestions = flatQuestionList(quiz);
    this.currentIndex = -1; // index into flatQuestions
    this.state = 'lobby'; // lobby | question | locked | reveal | leaderboard | gameover
    this.questionStartedAt = null;
    this.answers = new Map(); // playerId -> {answer, correct, points, atMs}
    this.lockTimer = null;
  }

  currentEntry() {
    if (this.currentIndex < 0 || this.currentIndex >= this.flatQuestions.length) return null;
    return this.flatQuestions[this.currentIndex];
  }

  playerList() {
    return Array.from(this.players.values())
      .map((p) => ({ id: p.id, name: p.name, score: p.score, connected: p.connected }))
      .sort((a, b) => b.score - a.score);
  }

  publicQuestionPayload() {
    const entry = this.currentEntry();
    if (!entry) return null;
    const { round, question, roundIndex, questionIndex } = entry;
    return {
      roundName: round.name,
      roundType: round.type || 'standard',
      media: question.media || round.media || null,
      questionNumber: this.currentIndex + 1,
      totalQuestions: this.flatQuestions.length,
      questionIndexInRound: questionIndex + 1,
      questionsInRound: round.questions.length,
      text: question.text,
      type: question.type,
      options: question.options || null,
      points: question.points,
      timeLimit: question.timeLimit,
      startedAt: this.questionStartedAt,
    };
  }
}

function gameRoom(code) {
  return `game:${code}`;
}

function broadcastState(game) {
  io.to(gameRoom(game.code)).emit('state:update', {
    state: game.state,
    players: game.playerList(),
  });
}

function emitPlayers(game) {
  io.to(gameRoom(game.code)).emit('players:update', game.playerList());
}

io.on('connection', (socket) => {
  // ----- Host events -----

  socket.on('host:createGame', (payload, cb) => {
    try {
      const quiz = loadQuiz(payload.quizFile);
      const code = makeGameCode();
      const game = new Game(code, quiz, socket.id);
      games.set(code, game);
      socket.join(gameRoom(code));
      socket.data.role = 'host';
      socket.data.gameCode = code;
      cb({ ok: true, code, title: quiz.title, totalQuestions: game.flatQuestions.length });
    } catch (e) {
      cb({ ok: false, error: e.message });
    }
  });

  socket.on('host:rejoin', ({ code }, cb) => {
    const game = games.get(code);
    if (!game) return cb({ ok: false, error: 'Game not found' });
    game.hostSocketId = socket.id;
    socket.join(gameRoom(code));
    socket.data.role = 'host';
    socket.data.gameCode = code;
    cb({ ok: true, state: game.state, players: game.playerList(), question: game.publicQuestionPayload() });
  });

  socket.on('host:startGame', ({ code }) => {
    const game = games.get(code);
    if (!game || socket.id !== game.hostSocketId) return;
    game.currentIndex = 0;
    startQuestion(game);
  });

  socket.on('host:lockAnswers', ({ code }) => {
    const game = games.get(code);
    if (!game || socket.id !== game.hostSocketId || game.state !== 'question') return;
    lockQuestion(game);
  });

  socket.on('host:revealAnswer', ({ code }) => {
    const game = games.get(code);
    if (!game || socket.id !== game.hostSocketId) return;
    if (game.state === 'question') lockQuestion(game);
    revealAnswer(game);
  });

  socket.on('host:showLeaderboard', ({ code }) => {
    const game = games.get(code);
    if (!game || socket.id !== game.hostSocketId) return;
    game.state = 'leaderboard';
    io.to(gameRoom(code)).emit('state:leaderboard', { players: game.playerList() });
  });

  socket.on('host:next', ({ code }) => {
    const game = games.get(code);
    if (!game || socket.id !== game.hostSocketId) return;
    const entry = game.currentEntry();
    const isLastInRound = entry && entry.questionIndex === entry.round.questions.length - 1;
    const isLastOverall = game.currentIndex >= game.flatQuestions.length - 1;

    if (isLastInRound && game.state !== 'leaderboard') {
      // show round leaderboard before moving to next round (or before game over)
      game.state = 'leaderboard';
      io.to(gameRoom(code)).emit('state:leaderboard', { players: game.playerList() });
      return;
    }
    if (isLastOverall) {
      game.state = 'gameover';
      io.to(gameRoom(code)).emit('state:gameover', { players: game.playerList() });
      return;
    }
    game.currentIndex += 1;
    startQuestion(game);
  });

  socket.on('host:endGame', ({ code }) => {
    const game = games.get(code);
    if (!game || socket.id !== game.hostSocketId) return;
    game.state = 'gameover';
    io.to(gameRoom(code)).emit('state:gameover', { players: game.playerList() });
  });

  // ----- Player events -----

  socket.on('player:join', ({ code, name, playerId }, cb) => {
    const game = games.get(code);
    if (!game) return cb({ ok: false, error: 'Game code not found' });
    const trimmedName = String(name || '').trim().slice(0, 24);
    if (!trimmedName) return cb({ ok: false, error: 'Enter a name' });

    let id = playerId;
    let player = id ? game.players.get(id) : null;

    if (player) {
      player.connected = true;
      player.socketId = socket.id;
      player.name = trimmedName;
    } else {
      id = crypto.randomUUID();
      player = { id, name: trimmedName, score: 0, connected: true, socketId: socket.id };
      game.players.set(id, player);
    }

    socket.join(gameRoom(code));
    socket.data.role = 'player';
    socket.data.gameCode = code;
    socket.data.playerId = id;

    emitPlayers(game);
    cb({
      ok: true,
      playerId: id,
      state: game.state,
      quizTitle: game.quiz.title,
      question: game.state === 'question' || game.state === 'locked' ? game.publicQuestionPayload() : null,
      alreadyAnswered: game.answers.has(id),
      players: game.playerList(),
    });
  });

  socket.on('player:submitAnswer', ({ code, answer }, cb) => {
    const game = games.get(code);
    const playerId = socket.data.playerId;
    if (!game || !playerId) return cb && cb({ ok: false, error: 'Not in a game' });
    if (game.state !== 'question') return cb && cb({ ok: false, error: 'Answers are closed' });
    if (game.answers.has(playerId)) return cb && cb({ ok: false, error: 'Already answered' });

    const entry = game.currentEntry();
    const { question } = entry;
    const elapsedMs = Date.now() - game.questionStartedAt;
    const timeLimitMs = question.timeLimit * 1000;

    let isCorrect = false;
    if (question.type === 'mc') {
      const idx = Number(answer);
      isCorrect = question.options[idx] !== undefined &&
        normalizeAnswer(question.options[idx]) === normalizeAnswer(question.correctAnswer);
    } else {
      const accepted = [question.correctAnswer, ...(question.acceptedAnswers || [])].map(normalizeAnswer);
      isCorrect = accepted.includes(normalizeAnswer(answer));
    }

    let points = 0;
    if (isCorrect) {
      const remainingFraction = Math.max(0, Math.min(1, 1 - elapsedMs / timeLimitMs));
      points = Math.round(question.points * (0.5 + 0.5 * remainingFraction));
    }

    game.answers.set(playerId, { answer, isCorrect, points, elapsedMs });
    const player = game.players.get(playerId);
    if (player) player.score += points;

    cb && cb({ ok: true, submitted: true });
    // let host see live answer count without revealing content
    io.to(game.hostSocketId).emit('host:answerCount', { count: game.answers.size, total: game.players.size });
  });

  socket.on('disconnect', () => {
    const { role, gameCode, playerId } = socket.data;
    if (!gameCode) return;
    const game = games.get(gameCode);
    if (!game) return;
    if (role === 'player' && playerId) {
      const player = game.players.get(playerId);
      if (player) {
        player.connected = false;
        emitPlayers(game);
      }
    }
    // Host disconnect: game stays alive, host can rejoin with host:rejoin
  });
});

function startQuestion(game) {
  game.state = 'question';
  game.answers = new Map();
  game.questionStartedAt = Date.now();
  io.to(gameRoom(game.code)).emit('state:question', game.publicQuestionPayload());

  const entry = game.currentEntry();
  if (game.lockTimer) clearTimeout(game.lockTimer);
  game.lockTimer = setTimeout(() => {
    if (game.state === 'question') lockQuestion(game);
  }, entry.question.timeLimit * 1000 + 300);
}

function lockQuestion(game) {
  game.state = 'locked';
  if (game.lockTimer) {
    clearTimeout(game.lockTimer);
    game.lockTimer = null;
  }
  io.to(gameRoom(game.code)).emit('state:locked');
}

function revealAnswer(game) {
  const entry = game.currentEntry();
  const { question } = entry;
  game.state = 'reveal';

  const results = Array.from(game.players.values()).map((p) => {
    const a = game.answers.get(p.id);
    return {
      playerId: p.id,
      name: p.name,
      answered: !!a,
      isCorrect: a ? a.isCorrect : false,
      pointsAwarded: a ? a.points : 0,
      score: p.score,
    };
  });

  io.to(gameRoom(game.code)).emit('state:reveal', {
    correctAnswer: question.type === 'mc' ? question.correctAnswer : question.correctAnswer,
    correctOptionIndex: question.type === 'mc'
      ? question.options.findIndex((o) => normalizeAnswer(o) === normalizeAnswer(question.correctAnswer))
      : null,
    results,
    players: game.playerList(),
  });
}

server.listen(PORT, () => {
  console.log(`Quiz Master running on http://localhost:${PORT}`);
  console.log(`Host screen:   http://localhost:${PORT}/host.html`);
  console.log(`Player screen: http://localhost:${PORT}/player.html`);
});
