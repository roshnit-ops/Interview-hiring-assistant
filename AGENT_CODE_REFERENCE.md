# VP of Sales Interview Tool — Code Reference

This document maps the full codebase of the live interview evaluation agent. All paths are relative to the project root: `SalesInterviewTool/`.

---

## Project structure

```
SalesInterviewTool/
├── client/                 # React (Vite) frontend
│   ├── public/
│   │   └── audio-processor.js   # AudioWorklet: mic/tab audio → PCM chunks
│   ├── src/
│   │   ├── main.jsx        # React root, error boundary
│   │   ├── App.jsx         # Home vs Interview; recovery state
│   │   ├── Home.jsx        # Calendar, email input, Start Interview
│   │   ├── Home.css
│   │   ├── Interview.jsx   # Live transcript, evaluation, suggested questions, final report
│   │   ├── Interview.css
│   │   ├── useStreamingTranscription.js  # AssemblyAI WebSocket + mic/tab capture
│   │   └── index.css       # Global variables and base styles
│   ├── index.html
│   └── vite.config.js     # Proxy /api → backend
├── server/                 # Express backend
│   ├── index.js            # Routes, static serve of client/dist
│   ├── env.js              # Load .env from project root
│   ├── tokenGenerator.js   # AssemblyAI temporary token
│   ├── rubric.json         # VP of Sales rubric (categories, weights, criteria)
│   ├── routes/
│   │   ├── evaluate.js     # Grok partial + final evaluation; email send
│   │   └── calendar.js     # Google OAuth + Calendar API
│   └── utils/
│       └── sendEvaluationEmail.js  # Resend: build HTML and send report
├── docs/
│   └── CALENDAR_AND_MEET.md
├── .env                    # Your keys (not in repo)
├── .env.example
├── package.json            # Scripts: install:all, build:client, start
└── README.md
```

---

## Main entry points

| What | File | Purpose |
|------|------|--------|
| **App entry** | `client/src/main.jsx` | Mounts React app with error boundary |
| **UI router** | `client/src/App.jsx` | Home vs Interview; recovery data from localStorage |
| **Backend** | `server/index.js` | Express app, API routes, serves built client from `client/dist` |

---

## Core flows

### 1. Audio → transcript
- **Capture:** `client/src/useStreamingTranscription.js` — `getUserMedia` (mic) and/or `getDisplayMedia` (tab) → AudioContext → AudioWorklet.
- **Worklet:** `client/public/audio-processor.js` — float32 → int16 PCM, posted to main thread.
- **Streaming:** Same hook opens WebSocket to AssemblyAI (`/api/token` for token), sends PCM, receives turns → `transcript` / `turns` state.

### 2. Live evaluation (partial)
- **Trigger:** `client/src/Interview.jsx` — on new turn and on interval, calls `POST /api/evaluate` with `{ transcript }`.
- **Backend:** `server/routes/evaluate.js` — `evaluatePartial()`: Grok with `PARTIAL_SYSTEM` prompt; returns `partial_scores`, `suggested_questions` (with `already_asked`), `red_flags`, `strengths`, `current_impression`.

### 3. Final report and email
- **Trigger:** User clicks “End Interview” in `Interview.jsx` → `runFinalEvaluation()` → `POST /api/evaluate-final` with `{ transcript, turns, recipientEmail }`.
- **Backend:** `evaluateFinal()` in `server/routes/evaluate.js` — Grok with `FINAL_SYSTEM`; then `await sendEvaluationEmail(parsed, transcript, turns, toEmail)`; response includes `emailSent`, `emailError`.
- **Email:** `server/utils/sendEvaluationEmail.js` — Resend API; HTML built from `parsed` (scores, recommendation, strengths/weaknesses/red flags, transcript). Recipient = `recipientEmail` from request or `RECIPIENT_EMAIL` from .env.

### 4. Recovery (don’t lose transcript)
- **Save:** On “End Interview”, `savePendingReport(transcript, turns, effectiveRecipientEmail)` in `Interview.jsx` writes to `localStorage` key `interviewPendingReport`.
- **Clear:** On successful final evaluation, `clearPendingReport()`.
- **Recovery:** `App.jsx` on load calls `getPendingReport()`; if data exists, shows recovery banner on Home. “Generate report” opens Interview with `recoveryData`; Interview shows transcript and “Generate report” to re-call evaluate-final.

### 5. Google Calendar
- **Routes:** `server/routes/calendar.js` — `getAuthUrl`, `callback` (OAuth, save tokens to `.calendar-tokens.json`), `listEvents` (next 7 days, Meet links), `getConnectionStatus`.
- **Frontend:** `Home.jsx` — Connect Calendar, list events, “Start evaluation” opens Meet in new tab and starts interview with same flow.

---

## Environment (.env)

- `ASSEMBLYAI_API_KEY` — Streaming STT
- `XAI_API_KEY` — Grok (x.ai)
- `PORT` — default 4000
- `RECIPIENT_EMAIL` — fallback for report email
- `RESEND_API_KEY` — send report via Resend
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` — optional Calendar
- `FRONTEND_ORIGIN` — optional; default `http://localhost:${PORT}`

---

## Key prompts (Grok)

- **Partial:** `PARTIAL_SYSTEM` in `server/routes/evaluate.js` — rubric, partial scores, suggested questions (with `already_asked`), red flags, strengths, current impression.
- **Final:** `FINAL_SYSTEM` — category scores, weighted score, hire recommendation, summary, strengths/weaknesses/red flags, questions_coverage (asked/missed).

---

## How to run

```bash
# From project root
npm run install:all   # once
npm start             # build client + start server at http://localhost:4000
```

The “agent” is this full stack: React UI + Express API + AssemblyAI streaming + Grok evaluation + Resend email + optional Google Calendar. All of the above files together are the code of this agent.
