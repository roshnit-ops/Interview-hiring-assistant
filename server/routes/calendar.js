import { google } from 'googleapis';
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..', '..');
const TOKENS_PATH = join(projectRoot, '.calendar-tokens.json');

function getEnvKey(varName) {
  try {
    const envPath = join(projectRoot, '.env');
    const content = readFileSync(envPath, 'utf-8');
    const line = content.split('\n').find((l) => l.startsWith(varName + '='));
    if (line) {
      let value = line.slice((varName + '=').length).trim();
      if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
      if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
      if (value) return value;
    }
  } catch (_) {}
  return process.env[varName] || '';
}

function loadTokens() {
  try {
    if (existsSync(TOKENS_PATH)) {
      return JSON.parse(readFileSync(TOKENS_PATH, 'utf-8'));
    }
  } catch (_) {}
  return null;
}

function saveTokens(tokens) {
  try {
    writeFileSync(TOKENS_PATH, JSON.stringify(tokens, null, 2), 'utf-8');
  } catch (err) {
    console.error('Failed to save calendar tokens:', err);
  }
}

function getOAuth2Client() {
  const clientId = getEnvKey('GOOGLE_CLIENT_ID');
  const clientSecret = getEnvKey('GOOGLE_CLIENT_SECRET');
  const redirectUri = getEnvKey('GOOGLE_CALENDAR_REDIRECT_URI') || 'http://localhost:4000/api/calendar/callback';
  if (!clientId || !clientSecret) return null;
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

export function getAuthUrl(req, res) {
  const oauth2 = getOAuth2Client();
  if (!oauth2) {
    return res.status(500).json({ error: 'Google Calendar not configured. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to .env' });
  }
  const url = oauth2.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/calendar.readonly'],
    prompt: 'consent',
  });
  res.json({ url });
}

export async function callback(req, res) {
  const { code } = req.query;
  const frontendOrigin = process.env.FRONTEND_ORIGIN || getEnvKey('FRONTEND_ORIGIN') || 'http://localhost:5173';
  if (!code) {
    return res.redirect(`${frontendOrigin}?calendar=error&message=no_code`);
  }
  const oauth2 = getOAuth2Client();
  if (!oauth2) {
    return res.redirect(`${frontendOrigin}?calendar=error&message=not_configured`);
  }
  try {
    const { tokens } = await oauth2.getToken(code);
    oauth2.setCredentials(tokens);
    saveTokens(tokens);
    return res.redirect(`${frontendOrigin}?calendar=connected`);
  } catch (err) {
    console.error('Calendar OAuth callback error:', err);
    return res.redirect(`${frontendOrigin}?calendar=error&message=exchange_failed`);
  }
}

async function listEventsWithCalendar(oauth2, calendar) {
  const now = new Date();
  const weekLater = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const { data } = await calendar.events.list({
    calendarId: 'primary',
    timeMin: now.toISOString(),
    timeMax: weekLater.toISOString(),
    singleEvents: true,
    orderBy: 'startTime',
    conferenceDataVersion: 1,
  });
  const events = (data.items || []).map((e) => {
    const start = e.start?.dateTime || e.start?.date;
    const meetFromConf = e.conferenceData?.entryPoints?.find(
      (p) => p.entryPointType === 'video' || (p.uri && p.uri.includes('meet.google.com'))
    );
    const meetLink = meetFromConf?.uri || e.hangoutLink || null;
    return {
      id: e.id,
      summary: e.summary || '(No title)',
      start,
      meetLink,
      htmlLink: e.htmlLink || null,
    };
  });
  return events;
}

export async function listEvents(req, res) {
  const oauth2 = getOAuth2Client();
  if (!oauth2) {
    return res.status(500).json({ error: 'Google Calendar not configured' });
  }
  const tokens = loadTokens();
  if (!tokens) {
    return res.status(401).json({ error: 'Not connected to Google Calendar. Connect first.' });
  }
  oauth2.setCredentials(tokens);
  const calendar = google.calendar({ version: 'v3', auth: oauth2 });
  let events;
  try {
    events = await listEventsWithCalendar(oauth2, calendar);
    return res.json({ events });
  } catch (err) {
    if (err.code === 401 || (err.response?.status === 401) || err.message?.includes('invalid_grant') || err.message?.includes('Token has been expired')) {
      if (tokens.refresh_token) {
        try {
          const { credentials } = await oauth2.refreshAccessToken();
          saveTokens(credentials);
          oauth2.setCredentials(credentials);
          events = await listEventsWithCalendar(oauth2, calendar);
          return res.json({ events });
        } catch (refreshErr) {
          console.error('Calendar token refresh failed:', refreshErr);
        }
      }
      try {
        unlinkSync(TOKENS_PATH);
      } catch (_) {}
      return res.status(401).json({ error: 'Calendar access expired. Please connect again.' });
    }
    console.error('Calendar list error:', err?.response?.data || err.message);
    const message = err?.response?.data?.error?.message || err.message || 'Failed to list events';
    return res.status(500).json({ error: message });
  }
}

export function getConnectionStatus(req, res) {
  const hasConfig = !!(getEnvKey('GOOGLE_CLIENT_ID') && getEnvKey('GOOGLE_CLIENT_SECRET'));
  const connected = hasConfig && !!loadTokens();
  res.json({ connected, hasConfig });
}
