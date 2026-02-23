import './env.js';
import express from 'express';
import cors from 'cors';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createReadStream, existsSync } from 'fs';
import { generateTempToken } from './tokenGenerator.js';
import { evaluatePartial, evaluateFinal, getRubricSampleQuestions } from './routes/evaluate.js';
import * as calendar from './routes/calendar.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');
const DIST = join(PROJECT_ROOT, 'client', 'dist');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({ origin: true }));
app.use(express.json());

const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || `http://localhost:${PORT}`;
process.env.FRONTEND_ORIGIN = FRONTEND_ORIGIN;

app.get('/api/token', async (req, res) => {
  try {
    const token = await generateTempToken(600);
    res.json({ token });
  } catch (err) {
    console.error('Token error:', err.response?.data || err.message);
    res.status(500).json({ error: 'Failed to generate token' });
  }
});

app.get('/api/rubric-sample-questions', getRubricSampleQuestions);
app.post('/api/evaluate', evaluatePartial);
app.post('/api/evaluate-final', evaluateFinal);

app.get('/api/calendar/auth-url', calendar.getAuthUrl);
app.get('/api/calendar/callback', calendar.callback);
app.get('/api/calendar/events', calendar.listEvents);
app.get('/api/calendar/status', calendar.getConnectionStatus);

if (existsSync(DIST)) {
  app.use(express.static(DIST, { index: false }));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(join(DIST, 'index.html'), (err) => {
      if (err) next(err);
    });
  });
} else {
  console.warn('client/dist not found at', DIST, '- run npm run build:client from project root');
  app.get('/', (req, res) => res.redirect(FRONTEND_ORIGIN));
  app.get('/api', (req, res) => res.redirect(FRONTEND_ORIGIN));
}

app.listen(PORT, () => {
  const key = process.env.XAI_API_KEY || '';
  console.log('Grok API key loaded: ' + (key ? key.substring(0, 12) + '...' : '(none)'));
  console.log(`Server running at http://localhost:${PORT}`);
});
