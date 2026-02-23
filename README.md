# VP of Sales — Live Interview Evaluation

A fully live web app that captures audio from your microphone, transcribes it in real time with AssemblyAI’s Streaming Speech-to-Text, and sends the conversation to Grok (x.ai) for rubric-based evaluation. Designed to run in a **separate browser tab** during a Google Meet interview so the interviewer gets live scores, suggested follow-up questions, red flags, and strengths. Optional **Google Calendar** integration lets you see upcoming meetings with Meet links and start evaluation in one click.

## Requirements

- **Node.js** 18+
- **AssemblyAI** account with Streaming API access (upgraded plan)
- **x.ai** API key (Grok)

## Setup

1. **Clone or copy the project** and open a terminal in the project root.

2. **Install dependencies** (root, client, and server):

   ```bash
   npm run install:all
   ```

   Or manually:

   ```bash
   npm install
   cd client && npm install
   cd ../server && npm install
   ```

3. **Environment variables**

   Copy `.env.example` to `.env` in the **project root** (not inside `server/`):

   ```bash
   cp .env.example .env
   ```

   Edit `.env` and set:

   - `ASSEMBLYAI_API_KEY` — your AssemblyAI API key (Streaming access)
   - `XAI_API_KEY` — your x.ai (Grok) API key
   - `PORT` — backend port (default `4000`)
   - `RECIPIENT_EMAIL` — email address to receive the evaluation report
   - **Email:** `RESEND_API_KEY` — to send the evaluation report by email when the interview ends (see [Resend](https://resend.com)).

   **Google Calendar (optional):** To see upcoming meetings with Google Meet links and start evaluation from the home page, set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in `.env`. Create OAuth 2.0 credentials in [Google Cloud Console](https://console.cloud.google.com/apis/credentials): Application type **Web application**, add redirect URI `http://localhost:4000/api/calendar/callback`. If your frontend runs on a different origin, set `FRONTEND_ORIGIN` (e.g. `http://localhost:5173`). See `docs/CALENDAR_AND_MEET.md` for details.

## Run locally

1. **Start the backend** (from project root):

   ```bash
   npm run dev:server
   ```

   Server runs at `http://localhost:4000` (or your `PORT`).

2. **Start the frontend** (in another terminal):

   ```bash
   npm run dev:client
   ```

   Vite runs at `http://localhost:5173` and proxies `/api` to the backend (ensure `PORT` in `.env` matches the proxy target).

3. **Open** `http://localhost:5173` in your browser.

4. **Usage**
   - Read the instructions on the home page.
   - (Optional) Connect **Google Calendar** to see upcoming meetings with Meet links; click **Start evaluation** on a meeting to open the Meet in a new tab and start the app’s capture in this tab.
   - Otherwise click **Start Interview (no meeting link)**, allow microphone access.
   - Use headphones and keep this tab open during your Google Meet; the app will transcribe and evaluate in real time.
   - Use **End Interview** when done to get the final weighted score and hire recommendation (and email if `RESEND_API_KEY` is set).

## Project structure

```
SalesInterviewTool/
├── client/                 # Vite + React frontend
│   ├── public/
│   │   └── audio-processor.js   # AudioWorklet for mic → PCM
│   ├── src/
│   │   ├── App.jsx
│   │   ├── Home.jsx        # Instructions + Start
│   │   ├── Interview.jsx   # Transcript + evaluation panel + End
│   │   ├── useStreamingTranscription.js  # AssemblyAI WebSocket + mic
│   │   └── ...
│   └── vite.config.js      # Proxy /api → backend (e.g. localhost:4000)
├── server/                 # Express backend
│   ├── index.js            # /api/token, /api/evaluate, /api/evaluate-final, /api/calendar/*
│   ├── tokenGenerator.js   # AssemblyAI temporary token
│   ├── rubric.json         # VP of Sales rubric (categories, weights, criteria)
│   └── routes/
│       ├── evaluate.js     # Grok (x.ai) partial + final evaluation
│       └── calendar.js     # Google OAuth + Calendar API (optional)
├── .env                    # API keys (create from .env.example)
├── .env.example
└── README.md
```

## API

- **GET /api/token** — Returns a short-lived AssemblyAI Streaming token so the browser can connect to their WebSocket without exposing your API key.
- **POST /api/evaluate** — Body: `{ "transcript": "..." }`. Returns partial scores (1–5 per category), suggested questions, red flags, strengths, and current impression.
- **POST /api/evaluate-final** — Body: `{ "transcript": "...", "turns": [...] }`. Returns category scores with justification, weighted overall score, hire recommendation, and summary; sends email if Resend is configured.
- **GET /api/calendar/status** — Returns `{ connected, hasConfig }` for Google Calendar.
- **GET /api/calendar/auth-url** — Returns `{ url }` for OAuth redirect.
- **GET /api/calendar/callback** — OAuth callback (redirects to frontend with `?calendar=connected` or `?calendar=error`).
- **GET /api/calendar/events** — Returns `{ events }` (next 7 days with Meet links); requires Calendar connected.

## Rubric

The VP of Sales rubric (categories, weights, criteria, and sample questions) is in `server/rubric.json` and is passed to Grok for both partial and final evaluations.

## Notes

- **No file upload** — Everything is live: mic → AssemblyAI → transcript → your backend → Grok.
- **Speaker diarization** — AssemblyAI’s streaming API does not support speaker labels in the single-channel flow; the transcript is chronological by turn.
- **Suggested questions** — Click any suggested question in the right panel to copy it to the clipboard.
