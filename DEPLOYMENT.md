# Deploying the Sales Interview Tool

## Can we deploy it?

Yes. The app can be deployed to any host that runs Node.js and can serve over HTTPS. You build the frontend once, then run the single Express server; it serves both the API and the built React app.

## Can we still make changes after deploying?

Yes. Deployment does not lock the app. Whenever you need to change something:

1. Edit the code locally (rubrics, UI, prompts, etc.).
2. Redeploy: push to Git (if your host auto-deploys from the repo) or run your host’s deploy/build again.
3. The live site will reflect the new version.

You keep full control of the codebase and can update it as often as you want.

---

## Build and run in production (single server)

From the **project root**:

```bash
npm run install:all
npm run build:client
cd server && node index.js
```

- The server reads `PORT` from the environment (default 3001; your host may set it automatically).
- It serves the React app from `client/dist` and all `/api` routes from the same origin, so no proxy or separate frontend URL is needed in production.

---

## Environment variables in production

Set these on your host (via its env / secrets UI), same as in `.env` locally:

| Variable | Required | Notes |
|----------|----------|--------|
| `ASSEMBLYAI_API_KEY` | Yes | For recording and live transcription |
| `XAI_API_KEY` | Yes | For Grok (evaluation) |
| `PORT` | No | Many hosts set this (e.g. 4000, 8080). Omit if they do. |
| `FRONTEND_ORIGIN` | Recommended | Your deployed app URL (e.g. `https://your-app.onrender.com`) for CORS and calendar redirects |

Optional: `SENDGRID_API_KEY`, `RECIPIENT_EMAIL`, Google Calendar keys — see `.env.example`.

---

## Where to deploy

### Render, Railway, Fly.io (easiest)

1. Connect your Git repo to the host.
2. Create a **Web Service**.
3. **Build command:** `npm run install:all && npm run build:client`
4. **Start command:** `cd server && node index.js`
5. **Root directory:** leave as repo root (or set if needed).
6. Add the env vars above in the dashboard.

### VPS (e.g. Ubuntu)

1. Clone the repo on the server.
2. Run: `npm run install:all && npm run build:client`
3. Run the server: `cd server && node index.js` (or use PM2: `pm2 start server/index.js --name sales-interview`).
4. Put a `.env` file in the project root with the same variables as above.
5. Put Nginx (or Caddy) in front for HTTPS and proxy to your Node port if needed.

### Frontend and backend separately (Vercel + Railway, etc.)

- **Frontend:** Build with `npm run build:client`, deploy `client/dist` (or the client folder with build command). Set your backend URL as the API base (you’d add a small config or env like `VITE_API_URL` and use it in the client for API_BASE).
- **Backend:** Deploy the `server` folder (or whole repo with start command `cd server && node index.js`) on Railway, Render, etc. Set `FRONTEND_ORIGIN` to your frontend URL for CORS.

---

## Quick checklist

- [ ] Env vars set on the host (`ASSEMBLYAI_API_KEY`, `XAI_API_KEY`, and optionally `FRONTEND_ORIGIN`)
- [ ] Build runs: `npm run build:client`
- [ ] Start command: `cd server && node index.js`
- [ ] App is served over HTTPS (required for microphone/tab capture in browsers)

After that, you can keep changing the app locally and redeploy whenever you want.
