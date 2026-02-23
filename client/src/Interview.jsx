import { useState, useRef, useCallback, useEffect } from 'react';
import { useStreamingTranscription } from './useStreamingTranscription';
import './Interview.css';

const API_BASE = '';
const PENDING_REPORT_KEY = 'interviewPendingReport';
const SUGGESTED_QUESTIONS_INTERVAL_MS = 25000; // refresh suggested questions every 25s
const MIN_TRANSCRIPT_FOR_QUESTIONS = 60; // chars - request questions as soon as we have a bit of transcript

async function fetchRubricSampleQuestions() {
  const res = await fetch(`${API_BASE}/api/rubric-sample-questions`);
  if (!res.ok) throw new Error(await res.text());
  const data = await res.json();
  return (data.questions || []).map((q) => ({
    question: typeof q === 'string' ? q : (q.question || ''),
    already_asked: false,
  }));
}

async function evaluatePartial(transcript) {
  const res = await fetch(`${API_BASE}/api/evaluate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transcript }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

/** Returns true if the question (or a significant part of it) appears in the transcript. Used to mark "asked" immediately. */
function questionAppearsInTranscript(question, transcript) {
  if (!question || !transcript || transcript.length < 20) return false;
  const q = question.toLowerCase().replace(/[?!.]/g, '').trim();
  const t = transcript.toLowerCase();
  if (q.length < 8) return t.includes(q);
  const words = q.split(/\s+/).filter((w) => w.length > 2);
  if (words.length < 2) return t.includes(q);
  const matchCount = words.filter((w) => t.includes(w)).length;
  return matchCount >= Math.min(3, words.length) && matchCount >= words.length * 0.35;
}

function savePendingReport(transcript, turns, recipientEmail) {
  try {
    localStorage.setItem(PENDING_REPORT_KEY, JSON.stringify({
      transcript,
      turns: turns || [],
      recipientEmail: recipientEmail || null,
      savedAt: Date.now(),
    }));
  } catch (_) {}
}

function clearPendingReport() {
  try {
    localStorage.removeItem(PENDING_REPORT_KEY);
  } catch (_) {}
}

export { clearPendingReport };

export function getPendingReport() {
  try {
    const raw = localStorage.getItem(PENDING_REPORT_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || !data.transcript || typeof data.transcript !== 'string') return null;
    if (Date.now() - (data.savedAt || 0) > 24 * 60 * 60 * 1000) {
      clearPendingReport();
      return null;
    }
    return data;
  } catch (_) {
    return null;
  }
}

async function evaluateFinal(transcript, turns, recipientEmail) {
  const res = await fetch(`${API_BASE}/api/evaluate-final`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      transcript,
      turns: turns || [],
      email: recipientEmail || undefined,
      recipientEmail: recipientEmail || undefined,
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    let msg = text;
    try {
      const j = JSON.parse(text);
      if (j && j.error) msg = j.error;
    } catch (_) {}
    throw new Error(msg || `Request failed (${res.status})`);
  }
  try {
    return JSON.parse(text);
  } catch (_) {
    throw new Error('Invalid response from server');
  }
}

const defaultSuggestedQuestions = [];

export default function Interview({ recipientEmail, onEnd, recoveryData }) {
  const isRecoveryMode = !!recoveryData;
  const [finalResult, setFinalResult] = useState(null);
  const [evaluating, setEvaluating] = useState(false);
  const [copyHint, setCopyHint] = useState(null);
  const [audioSource, setAudioSource] = useState('both');
  /** Standard questions from rubric — shown from the start, before interview. */
  const [rubricQuestions, setRubricQuestions] = useState([]);
  const [rubricQuestionsLoading, setRubricQuestionsLoading] = useState(true);
  /** Questions from partial API — replace rubric list as interview proceeds. */
  const [suggestedQuestionsFromApi, setSuggestedQuestionsFromApi] = useState(defaultSuggestedQuestions);
  const [questionsLoading, setQuestionsLoading] = useState(false);
  /** Live evaluation (partial scores, impression, red flags, strengths). */
  const [partialResult, setPartialResult] = useState(null);
  const transcriptRef = useRef('');
  const partialIntervalRef = useRef(null);

  const { transcript: liveTranscript, turns: liveTurns, isConnected, error, start, stop } = useStreamingTranscription({
    onTurn: () => {},
    onError: (err) => console.error(err),
  });
  const transcript = isRecoveryMode ? (recoveryData?.transcript ?? '') : liveTranscript;
  const turns = isRecoveryMode ? (recoveryData?.turns ?? []) : liveTurns;
  const effectiveRecipientEmail = isRecoveryMode ? (recoveryData?.recipientEmail ?? null) : recipientEmail;

  transcriptRef.current = transcript;

  // Load standard rubric questions on mount (show before interview starts).
  useEffect(() => {
    if (isRecoveryMode) return;
    setRubricQuestionsLoading(true);
    fetchRubricSampleQuestions()
      .then(setRubricQuestions)
      .catch((err) => console.error('Rubric questions fetch failed:', err))
      .finally(() => setRubricQuestionsLoading(false));
  }, [isRecoveryMode]);

  const fetchPartialEvaluation = useCallback(async () => {
    const t = transcriptRef.current;
    if (!t.trim() || t.length < MIN_TRANSCRIPT_FOR_QUESTIONS) return;
    setQuestionsLoading(true);
    try {
      const result = await evaluatePartial(t);
      setPartialResult({
        partial_scores: result.partial_scores || [],
        red_flags: result.red_flags || [],
        strengths: result.strengths || [],
        current_impression: result.current_impression || '',
      });
      const raw = result.suggested_questions || [];
      const list = raw.map((item) =>
        typeof item === 'string' ? { question: item, already_asked: false } : { question: item?.question ?? '', already_asked: !!item?.already_asked }
      );
      setSuggestedQuestionsFromApi(list.slice(0, 10));
    } catch (err) {
      console.error('Partial evaluation fetch failed:', err);
    } finally {
      setQuestionsLoading(false);
    }
  }, []);

  const hasEnoughTranscript = transcript.trim().length >= MIN_TRANSCRIPT_FOR_QUESTIONS;
  useEffect(() => {
    if (isRecoveryMode || !isConnected || !hasEnoughTranscript) return;
    fetchPartialEvaluation();
    partialIntervalRef.current = setInterval(fetchPartialEvaluation, SUGGESTED_QUESTIONS_INTERVAL_MS);
    return () => {
      if (partialIntervalRef.current) {
        clearInterval(partialIntervalRef.current);
        partialIntervalRef.current = null;
      }
    };
  }, [isConnected, isRecoveryMode, hasEnoughTranscript, fetchPartialEvaluation]);

  const runFinalEvaluation = useCallback(async () => {
    if (!transcript.trim()) {
      setFinalResult({ error: 'No transcript to evaluate.' });
      return;
    }
    setEvaluating(true);
    savePendingReport(transcript, turns, effectiveRecipientEmail);
    try {
      const result = await evaluateFinal(transcript, turns, effectiveRecipientEmail);
      clearPendingReport();
      setFinalResult(result);
    } catch (err) {
      setFinalResult({ error: err.message });
    } finally {
      setEvaluating(false);
    }
  }, [transcript, turns, effectiveRecipientEmail]);

  const handleEndInterview = useCallback(async () => {
    stop();
    await runFinalEvaluation();
  }, [stop, runFinalEvaluation]);

  const handleRetryFinal = useCallback(() => {
    setFinalResult(null);
    runFinalEvaluation();
  }, [runFinalEvaluation]);

  const handleStart = useCallback(async () => {
    await start(audioSource);
  }, [start, audioSource]);

  const copyQuestion = (q) => {
    navigator.clipboard.writeText(q);
    setCopyHint(q.slice(0, 40) + '…');
    setTimeout(() => setCopyHint(null), 2000);
  };

  const showFinal = finalResult !== null;

  return (
    <div className="interview-layout">
      <header className="interview-header">
        <h1>Live Interview</h1>
        <div className="header-actions">
          {!isConnected && !showFinal && !isRecoveryMode && (
            <div className="start-recording-row">
              <label className="audio-source-label">
                <span>Audio from:</span>
                <select
                  value={audioSource}
                  onChange={(e) => setAudioSource(e.target.value)}
                  className="audio-source-select"
                >
                  <option value="both">Both (mic + meeting tab)</option>
                  <option value="tab">Meeting tab only (candidate)</option>
                  <option value="mic">Microphone only (interviewer)</option>
                </select>
              </label>
              <button className="btn btn-primary" onClick={handleStart} disabled={evaluating}>
                Start recording
              </button>
            </div>
          )}
          {isConnected && !showFinal && !isRecoveryMode && (
            <button className="btn btn-danger" onClick={handleEndInterview} disabled={evaluating}>
              End Interview
            </button>
          )}
          {isRecoveryMode && !showFinal && (
            <button className="btn btn-secondary" onClick={onEnd}>Back to home</button>
          )}
          {showFinal && (
            <button className="btn btn-secondary" onClick={onEnd}>
              Back to home
            </button>
          )}
        </div>
      </header>

      {evaluating && (
        <div className="banner generating-report" role="status">
          Generating your report… Please don&apos;t close or refresh this page. Your transcript is saved and can be recovered if something goes wrong.
        </div>
      )}
      {error && !isRecoveryMode && <div className="banner error">{error}</div>}
      {!isConnected && !showFinal && !isRecoveryMode && (audioSource === 'tab' || audioSource === 'both') && (
        <p className="audio-source-hint">
          {audioSource === 'both'
            ? 'Click Start recording: first share the meeting tab (check &quot;Share tab audio&quot;) so we capture the candidate, then allow microphone for your questions.'
            : 'When you click Start recording, choose the tab where your meeting is running and check &quot;Share tab audio&quot;.'}
        </p>
      )}
      {isConnected && <div className="banner success">Recording — transcript updating live.</div>}

      {showFinal ? (
        <div className="final-view">
          <FinalReport result={finalResult} transcript={transcript} recipientEmail={effectiveRecipientEmail} onBack={onEnd} onRetry={handleRetryFinal} />
        </div>
      ) : isRecoveryMode ? (
        <div className="recovery-view">
          <h2>Recovered interview</h2>
          <p className="muted">Your transcript was saved. Generate the evaluation report now.</p>
          <div className="panel transcript-panel" style={{ marginBottom: '1rem' }}>
            <h3>Transcript</h3>
            <div className="transcript-scroll">
              {(turns && turns.length > 0) ? turns.map((t, i) => (
                <p key={i} className="transcript-turn">{t}</p>
              )) : <p className="transcript-placeholder">{transcript || 'No transcript.'}</p>}
            </div>
          </div>
          <button className="btn btn-primary" onClick={runFinalEvaluation} disabled={evaluating}>
            {evaluating ? 'Generating report…' : 'Generate report'}
          </button>
        </div>
      ) : (
        <div className="interview-body" data-layout="eval-transcript-left-questions-right">
          <div className="interview-top">
            <div className="interview-left-column">
              <div className="panel evaluation-panel" data-area="evaluation">
                <h2>Live evaluation</h2>
                {!partialResult && !isConnected && (
                  <p className="muted evaluation-placeholder">Start recording to see live scores and impressions.</p>
                )}
                {!partialResult && isConnected && !hasEnoughTranscript && (
                  <p className="muted evaluation-placeholder">Say a bit more to see live evaluation.</p>
                )}
                {!partialResult && isConnected && hasEnoughTranscript && questionsLoading && (
                  <p className="muted evaluation-placeholder">Updating…</p>
                )}
                {partialResult && (
                  <>
                    <ScoresTable scores={partialResult.partial_scores} />
                    <CurrentImpression text={partialResult.current_impression} />
                    <RedFlags list={partialResult.red_flags} />
                    <Strengths list={partialResult.strengths} />
                  </>
                )}
              </div>

              <div className="panel transcript-panel" data-area="transcript">
                <h2>Live transcript</h2>
                <div className="transcript-scroll">
                  {turns.length > 0 ? (
                    turns.map((t, i) => (
                      <p key={i} className="transcript-turn">
                        {t}
                      </p>
                    ))
                  ) : (
                    <p className="transcript-placeholder">
                      {isConnected ? 'Speaking will appear here…' : 'Start recording to begin.'}
                    </p>
                  )}
                </div>
              </div>
            </div>

            <div className="panel questions-panel" data-area="questions">
              <h2>Suggested questions</h2>
              {rubricQuestionsLoading && rubricQuestions.length === 0 ? (
                <p className="muted">Loading questions…</p>
              ) : (
                <SuggestedQuestions
                  questions={(suggestedQuestionsFromApi.length > 0 ? suggestedQuestionsFromApi : rubricQuestions).map((item) => ({
                    question: item.question,
                    already_asked: item.already_asked || questionAppearsInTranscript(item.question, transcript),
                  }))}
                  onCopy={copyQuestion}
                  copyHint={copyHint}
                />
              )}
              {!rubricQuestionsLoading && rubricQuestions.length === 0 && suggestedQuestionsFromApi.length === 0 && (
                <p className="muted">No suggested questions available.</p>
              )}
              {isConnected && hasEnoughTranscript && suggestedQuestionsFromApi.length === 0 && (
                <p className="muted" style={{ marginTop: '0.5rem', fontSize: '0.85rem' }}>
                  Questions will update as the interview progresses.
                </p>
              )}
              <p className="evaluation-final-only-msg" style={{ marginTop: '1rem', fontSize: '0.85rem' }}>
                Full report is generated when you <strong>End Interview</strong>.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ScoresTable({ scores }) {
  if (!scores?.length) return null;
  return (
    <section className="block">
      <h3>Partial scores (1–5)</h3>
      <table className="scores-table">
        <thead>
          <tr>
            <th>Category</th>
            <th>Score</th>
            <th>Justification</th>
          </tr>
        </thead>
        <tbody>
          {scores.map((row, i) => (
            <tr key={i}>
              <td>{row.name}</td>
              <td>{row.score}</td>
              <td>{row.justification}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function SuggestedQuestions({ questions, onCopy, copyHint }) {
  if (!questions?.length) return null;
  const items = questions.map((q) =>
    typeof q === 'string' ? { question: q, already_asked: false } : { question: q?.question ?? '', already_asked: !!q?.already_asked }
  );
  return (
    <>
      <p className="hint">Click to copy. Gray = already asked; green = still to ask.</p>
      <ul className="question-list">
        {items.map((item, i) => (
          <li key={i} className={item.already_asked ? 'question-asked' : 'question-to-ask'}>
            <span className="question-badge">{item.already_asked ? 'Asked' : 'To ask'}</span>
            <button type="button" className="question-btn" onClick={() => onCopy(item.question)}>
              {item.question}
            </button>
          </li>
        ))}
      </ul>
      {copyHint && <p className="copy-hint">Copied: {copyHint}</p>}
    </>
  );
}

function RedFlags({ list }) {
  if (!list?.length) return null;
  return (
    <section className="block red-flags">
      <h3>Red flags</h3>
      <ul>
        {list.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>
    </section>
  );
}

function Strengths({ list }) {
  if (!list?.length) return null;
  return (
    <section className="block strengths">
      <h3>Strengths</h3>
      <ul>
        {list.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>
    </section>
  );
}

function CurrentImpression({ text }) {
  if (!text) return null;
  return (
    <section className="block">
      <h3>Current impression</h3>
      <p className="impression">{text}</p>
    </section>
  );
}

function FinalReport({ result, transcript, recipientEmail, onBack, onRetry }) {
  const isError = result && result.error;
  const hasReport = result && !result.error && (result.hire_recommendation != null || (result.category_scores && result.category_scores.length > 0));
  if (isError) {
    return (
      <div className="final-content">
        <h2>Final evaluation</h2>
        <p className="error-msg">{result.error}</p>
        <p className="muted" style={{ marginTop: '0.5rem', fontSize: '0.85rem' }}>Your transcript was saved. You can retry or go back home.</p>
        <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem' }}>
          {onRetry && <button className="btn btn-primary" onClick={onRetry}>Retry report</button>}
          <button className="btn btn-secondary" onClick={onBack}>Back to home</button>
        </div>
      </div>
    );
  }
  if (!hasReport) {
    return (
      <div className="final-content">
        <h2>Final evaluation</h2>
        <p className="error-msg">No evaluation data received. Check the server terminal for errors.</p>
        <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem' }}>
          {onRetry && <button className="btn btn-primary" onClick={onRetry}>Retry report</button>}
          <button className="btn btn-secondary" onClick={onBack}>Back to home</button>
        </div>
      </div>
    );
  }

  const scores = result.category_scores || [];
  const recommendation = result.hire_recommendation || '';
  const summary = result.summary || '';
  const weighted = result.weighted_overall_score;
  const strengths = result.strengths || [];
  const weaknesses = result.weaknesses || [];
  const redFlags = result.red_flags || [];
  const hasSummaryLists = strengths.length > 0 || weaknesses.length > 0 || redFlags.length > 0;

  return (
    <div className="final-content">
      <h2>Final evaluation</h2>

      {recipientEmail && result.emailSent ? (
        <div className="email-success-banner">
          Full evaluation report has been emailed to {recipientEmail}
        </div>
      ) : recipientEmail && result.emailSent === false ? (
        <div className="email-error-banner" role="alert">
          <strong>Report generated but email could not be sent.</strong> Please check your email manually or copy the report below.
          {result.emailError && <p className="email-error-hint">{result.emailError}</p>}
        </div>
      ) : !recipientEmail ? (
        <p className="muted email-skip-msg">Report was not emailed (no address was provided). Add your email on the home page next time to receive it.</p>
      ) : null}

      <section className="block final-recommendation-block">
        <h3>Hire recommendation</h3>
        <p className={`recommendation recommendation-${recommendation.replace(/\s+/g, '-').toLowerCase()}`}>
          {recommendation || '—'}
        </p>
      </section>

      <section className="block">
        <h3>Weighted overall score</h3>
        <p className="weighted-score">{weighted != null ? Number(weighted).toFixed(1) : '—'} / 100</p>
      </section>

      {scores.length > 0 && (
        <section className="block">
          <h3>Category scores (1–5) & justification</h3>
          <table className="scores-table final-scores-table">
            <thead>
              <tr>
                <th>Category</th>
                <th>Score</th>
                <th>Justification</th>
              </tr>
            </thead>
            <tbody>
              {scores.map((row, i) => (
                <tr key={i}>
                  <td className="category-name">{row.name}</td>
                  <td className="score-num">{row.score}</td>
                  <td className="justification-cell">{row.justification}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {hasSummaryLists && (
        <section className="block summary-lists">
          <h3>Summary: strengths, weaknesses & red flags</h3>
          {strengths.length > 0 && (
            <div className="summary-sub">
              <h4>Strengths</h4>
              <ul>
                {strengths.map((item, i) => (
                  <li key={i} className="strength-item">{item}</li>
                ))}
              </ul>
            </div>
          )}
          {weaknesses.length > 0 && (
            <div className="summary-sub">
              <h4>Weaknesses</h4>
              <ul>
                {weaknesses.map((item, i) => (
                  <li key={i} className="weakness-item">{item}</li>
                ))}
              </ul>
            </div>
          )}
          {redFlags.length > 0 && (
            <div className="summary-sub">
              <h4>Red flags</h4>
              <ul>
                {redFlags.map((item, i) => (
                  <li key={i} className="red-flag-item">{item}</li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {result.questions_coverage && (
        <section className="block questions-coverage-block">
          <h3>Questions coverage (vs. rubric)</h3>
          {(result.questions_coverage.asked?.length > 0 || result.questions_coverage.missed?.length > 0) ? (
            <>
              {result.questions_coverage.asked?.length > 0 && (
                <div className="summary-sub">
                  <h4>Questions / topics asked</h4>
                  <ul>
                    {result.questions_coverage.asked.map((a, i) => (
                      <li key={i}><strong>{a.category}:</strong> {a.question_or_topic}</li>
                    ))}
                  </ul>
                </div>
              )}
              {result.questions_coverage.missed?.length > 0 && (
                <div className="summary-sub">
                  <h4>Questions missed (recommended from rubric)</h4>
                  <ul>
                    {result.questions_coverage.missed.map((m, i) => (
                      <li key={i}>
                        <strong>{m.category}:</strong>
                        <ul>
                          {(m.sample_questions_not_asked || []).map((q, j) => (
                            <li key={j}>{q}</li>
                          ))}
                        </ul>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          ) : (
            <p className="muted">No questions coverage data.</p>
          )}
        </section>
      )}

      <section className="block">
        <h3>Overall summary</h3>
        <p className="summary">{summary}</p>
      </section>

      <section className="block">
        <h3>Full transcript</h3>
        <div className="final-transcript">{transcript || '—'}</div>
      </section>

      <button className="btn btn-secondary" onClick={onBack}>Back to home</button>
    </div>
  );
}
