import { useState, useEffect } from 'react';
import './Home.css';

const API = '';

async function getCalendarStatus() {
  const res = await fetch(`${API}/api/calendar/status`);
  if (!res.ok) return { connected: false, hasConfig: false };
  return res.json();
}

async function getCalendarAuthUrl() {
  const res = await fetch(`${API}/api/calendar/auth-url`);
  if (!res.ok) throw new Error('Failed to get auth URL');
  const data = await res.json();
  return data.url;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isValidEmail(value) {
  if (!value || typeof value !== 'string') return false;
  return EMAIL_REGEX.test(value.trim());
}

async function getCalendarEvents() {
  const res = await fetch(`${API}/api/calendar/events`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data.error || (res.status === 401 ? 'Not connected' : 'Failed to load events');
    throw new Error(msg);
  }
  return data.events || [];
}

export default function Home({ onStart, recoveryData, onRecoveryStart, onRecoveryClear }) {
  const [calendarConnected, setCalendarConnected] = useState(false);
  const [calendarConfigured, setCalendarConfigured] = useState(false);
  const [events, setEvents] = useState([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [calendarError, setCalendarError] = useState(null);
  const [recipientEmail, setRecipientEmail] = useState('');
  const [emailError, setEmailError] = useState('');

  useEffect(() => {
    getCalendarStatus().then(({ connected, hasConfig }) => {
      setCalendarConnected(!!connected);
      setCalendarConfigured(!!hasConfig);
      if (connected) {
        setEventsLoading(true);
        setCalendarError(null);
        getCalendarEvents()
          .then((list) => {
            setEvents(list);
            setCalendarError(null);
          })
          .catch((e) => setCalendarError(e.message))
          .finally(() => setEventsLoading(false));
      }
    });
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const calendar = params.get('calendar');
    if (calendar === 'connected') {
      setCalendarConnected(true);
      setCalendarConfigured(true);
      setEventsLoading(true);
      setCalendarError(null);
      getCalendarEvents()
        .then((list) => {
          setEvents(list);
          setCalendarError(null);
        })
        .catch((e) => setCalendarError(e.message))
        .finally(() => setEventsLoading(false));
      window.history.replaceState({}, '', window.location.pathname);
    }
    if (calendar === 'error') {
      setCalendarError(params.get('message') || 'Calendar connection failed');
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  const handleConnectCalendar = async () => {
    try {
      const url = await getCalendarAuthUrl();
      window.location.href = url;
    } catch (e) {
      setCalendarError(e.message);
    }
  };

  const validateAndGetEmail = () => {
    setEmailError('');
    const trimmed = (recipientEmail && String(recipientEmail).trim()) || '';
    if (!trimmed) return null;
    if (!isValidEmail(trimmed)) {
      setEmailError('Please enter a valid email address.');
      return undefined;
    }
    return trimmed;
  };

  const handleStartForMeeting = (meeting) => {
    if (meeting.meetLink) window.open(meeting.meetLink, '_blank', 'noopener,noreferrer');
    const email = validateAndGetEmail();
    if (email !== undefined) onStart(email);
  };

  const handleStartInterview = () => {
    const email = validateAndGetEmail();
    if (email !== undefined) onStart(email);
  };

  const formatStart = (start) => {
    if (!start) return '';
    const d = new Date(start);
    return d.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="home">
      <header className="home-header">
        <h1>VP of Sales — Live Interview Evaluation</h1>
        <p className="subtitle">Real-time rubric scoring and follow-up suggestions</p>
      </header>

      {recoveryData && (
        <div className="recovery-banner">
          <p><strong>Your last interview didn’t finish.</strong> The transcript was saved. You can generate the report now or clear it.</p>
          <div className="recovery-banner-actions">
            <button type="button" className="btn btn-primary" onClick={onRecoveryStart}>
              Generate report
            </button>
            <button type="button" className="btn btn-secondary" onClick={onRecoveryClear}>
              Clear
            </button>
          </div>
        </div>
      )}

      {calendarConfigured && (
        <section className="calendar-section">
          <h2>Google Calendar</h2>
          {calendarError && <p className="calendar-error">{calendarError}</p>}
          {!calendarConnected ? (
            <>
              <p className="calendar-hint">Connect your calendar to see meetings with Google Meet links and start evaluation in one click.</p>
              <button type="button" className="btn btn-calendar" onClick={handleConnectCalendar}>
                Connect Google Calendar
              </button>
            </>
          ) : (
            <>
              <p className="calendar-connected">Upcoming events (next 7 days). Start evaluation for those with a Meet link:</p>
              {eventsLoading ? (
                <p className="muted">Loading events…</p>
              ) : events.length === 0 ? (
                <p className="muted">No upcoming events in the next 7 days.</p>
              ) : (
                <ul className="meeting-list">
                  {events.map((ev) => (
                    <li key={ev.id} className="meeting-item">
                      <div className="meeting-info">
                        <span className="meeting-title">{ev.summary}</span>
                        <span className="meeting-time">{formatStart(ev.start)}</span>
                        {!ev.meetLink && <span className="meeting-no-meet">No Meet link</span>}
                      </div>
                      {ev.meetLink ? (
                        <button
                          type="button"
                          className="btn btn-start-meeting"
                          onClick={() => handleStartForMeeting(ev)}
                        >
                          Start evaluation
                        </button>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </section>
      )}

      <section className="email-section">
        <label htmlFor="recipient-email" className="email-label">
          Email for evaluation report
        </label>
        <input
          id="recipient-email"
          type="email"
          placeholder="you@company.com"
          value={recipientEmail}
          onChange={(e) => {
            setRecipientEmail(e.target.value);
            if (emailError) setEmailError('');
          }}
          className={`email-input ${emailError ? 'email-input-invalid' : ''}`}
          aria-invalid={!!emailError}
          aria-describedby={emailError ? 'email-error' : 'email-hint'}
        />
        <p id="email-hint" className="email-hint">The final report will be sent to this address after you end the interview.</p>
        {emailError && <p id="email-error" className="email-error" role="alert">{emailError}</p>}
      </section>

      <button className="btn-start" onClick={handleStartInterview}>
        Start Interview
      </button>
    </div>
  );
}
