# Quiz Master

A self-hosted live quiz app. You add your own questions through a simple on-screen
form (no files, no code), then send friends one link — in Messenger, Teams,
WhatsApp, email, whatever you already use — and they join from their own phone or
laptop with a game code, answer, and see a live scoreboard. Supports standard
rounds, music rounds (embedded song clips), and film rounds (embedded video clips).

## The three things you do

1. **Add your questions** — open the app, click "Add / Edit Questions," fill in a
   form. No JSON, no files.
2. **Put it online once** — deploy it to a free host (see below). You get a
   permanent web address.
3. **Share it** — paste that address into Messenger, Teams, WhatsApp, or an email,
   the same way you'd share any link. Friends click it, type the game code you give
   them, and play. Nothing to install on their end.

## Try it locally

You need [Node.js](https://nodejs.org) installed once (free, takes a minute).

```
npm install
npm start
```

Now open `http://localhost:3000/host.html` in your browser. Click **+ Add / Edit
Questions**. That opens the builder:

- Click **+ New Quiz**, give it a title.
- Click **+ Add Round** for each section (General Knowledge, Music Round, Film
  Round...) and pick its type from the dropdown.
- Click **+ Add Question** inside a round. Choose multiple-choice or type-in-answer,
  fill in the question, options/answer, points, and time limit.
- For Music/Film rounds, paste a YouTube link into the clip field (and optionally
  the second it should start at) — it'll auto-play for everyone when that question
  comes up.
- Click **Save Quiz**. It's now ready to play from the Host page.

A sample quiz (`sample-quiz.json`) is included so you can see the format and try a
game immediately, but you'll normally never need to look at the JSON — the builder
does that for you.

## Put it online (Render, free)

1. Push this folder to a GitHub repository.
2. Go to **[render.com](https://render.com)** and sign up (free, no credit card).
3. Click **New > Web Service**, connect your GitHub repo.
4. Set Build Command: `npm install`, Start Command: `npm start`, Instance Type: Free.
5. Click **Create Web Service**. After it deploys, Render gives you a URL like
   `https://your-quiz.onrender.com`.
6. Host screen: `https://your-quiz.onrender.com/host.html`
   Player link to share: `https://your-quiz.onrender.com/player.html`

Free-tier services sleep after inactivity and take 30-60 seconds to wake up on the
first request — open your host page a couple of minutes before your friends join.

## Share it in Messenger / Teams / WhatsApp / anywhere

There's no special integration needed — it's just a normal web link:

1. Open your host page, pick the quiz, click **Create Game**. You'll get a 4-letter
   code (e.g. `7K2Q`).
2. Paste your player link plus the code into any chat app, e.g.:
   > Join my quiz! 👉 https://your-quiz.onrender.com/player.html — code: **7K2Q**
3. Friends tap the link, type the code and their name, and they're in the lobby.
   You click **Start Game** when everyone's ready.

## How a game plays out

Each question is pushed to everyone at once with a countdown timer.
Multiple-choice is tap-to-answer; other questions are type-your-answer. Scoring is
automatic (faster correct answers score slightly more). You click **Lock Answers**
(or let the timer run out) then **Reveal Answer** — everyone sees whether they were
right and their updated score. **Next** advances to the next question, or to a round
leaderboard between rounds, ending in a final leaderboard.

## Notes and limitations

- Scoring happens on the server, so players can't edit their own score.
- If someone's browser refreshes mid-game, they rejoin with the same name/score
  (remembered in that browser).
- YouTube clips load independently on each player's device — playback starts when
  the host advances the question, but isn't frame-perfectly synced across everyone's
  screens. Fine for "name that tune," not for anything timing-critical.
- Free-text answers are auto-scored by close text matching (ignoring case,
  punctuation, "the/a/an"). For quirky answers, add alternates in the "other
  accepted answers" field in the builder, or use multiple-choice instead.
