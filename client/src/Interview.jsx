import { useState, useRef, useCallback, useEffect } from 'react';
import { useStreamingTranscription } from './useStreamingTranscription';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import './Interview.css';

const API_BASE = '';
const PENDING_REPORT_KEY = 'interviewPendingReport';
const ROLE_LABELS = { 'vp-sales': 'VP of Sales', 'vp-ta': 'VP of TA', 'account-executive': 'Account Executive' };
const SUGGESTED_QUESTIONS_INTERVAL_MS = 25000; // refresh suggested questions every 25s
const MIN_TRANSCRIPT_FOR_QUESTIONS = 60; // chars - request questions as soon as we have a bit of transcript

async function fetchRubricSampleQuestions(role) {
  const url = role ? `${API_BASE}/api/rubric-sample-questions?role=${encodeURIComponent(role)}` : `${API_BASE}/api/rubric-sample-questions`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(await res.text());
  const data = await res.json();
  return (data.questions || []).map((q) => ({
    question: typeof q === 'string' ? q : (q.question || q),
    already_asked: false,
    category: typeof q === 'object' ? q.category : undefined,
    weight_pct: typeof q === 'object' ? q.weight_pct : undefined,
  }));
}

/** True if the question (or its key phrases) appears in the transcript — interviewer likely asked it. */
function questionAskedInTranscript(question, transcript) {
  if (!question || !transcript || transcript.length < 30) return false;
  const q = question.toLowerCase().replace(/[?!.]/g, '').trim();
  const t = transcript.toLowerCase();
  if (q.length < 15) return t.includes(q);
  const stopWords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been', 'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'must', 'can', 'you', 'your', 'me', 'my', 'we', 'our', 'they', 'their', 'it', 'its', 'this', 'that', 'what', 'which', 'who', 'how', 'when', 'where', 'why']);
  const words = q.split(/\s+/).filter((w) => w.length > 2 && !stopWords.has(w));
  if (words.length < 2) return t.includes(q.slice(0, 40));
  const matchCount = words.filter((w) => t.includes(w)).length;
  return matchCount >= Math.min(3, words.length) && matchCount >= words.length * 0.35;
}

async function evaluatePartial(transcript, role) {
  const res = await fetch(`${API_BASE}/api/evaluate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transcript, role: role || 'vp-sales' }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

function savePendingReport(transcript, turns, recipientEmail, selectedRole) {
  try {
    localStorage.setItem(PENDING_REPORT_KEY, JSON.stringify({
      transcript,
      turns: turns || [],
      recipientEmail: recipientEmail || null,
      selectedRole: selectedRole || 'vp-sales',
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

async function evaluateFinal(transcript, turns, role) {
  const res = await fetch(`${API_BASE}/api/evaluate-final`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      transcript,
      turns: turns || [],
      role: role || 'vp-sales',
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

export default function Interview({ selectedRole: selectedRoleProp, recipientEmail, onEnd, recoveryData }) {
  const isRecoveryMode = !!recoveryData;
  const selectedRole = isRecoveryMode ? (recoveryData?.selectedRole ?? selectedRoleProp ?? 'vp-sales') : (selectedRoleProp ?? 'vp-sales');
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

  const { transcript: liveTranscript, turns: liveTurns, isConnected, isStarting, error, start, stop } = useStreamingTranscription({
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
    fetchRubricSampleQuestions(selectedRole)
      .then(setRubricQuestions)
      .catch((err) => console.error('Rubric questions fetch failed:', err))
      .finally(() => setRubricQuestionsLoading(false));
  }, [isRecoveryMode, selectedRole]);

  const fetchPartialEvaluation = useCallback(async () => {
    const t = transcriptRef.current;
    if (!t.trim() || t.length < MIN_TRANSCRIPT_FOR_QUESTIONS) return;
    setQuestionsLoading(true);
    try {
      const result = await evaluatePartial(t, selectedRole);
      setPartialResult({
        partial_scores: result.partial_scores || [],
        red_flags: result.red_flags || [],
        strengths: result.strengths || [],
        current_impression: result.current_impression || '',
      });
      const raw = result.suggested_questions || [];
      const list = raw.map((item) =>
        typeof item === 'string'
          ? { question: item, already_asked: false }
          : {
              question: item?.question ?? '',
              already_asked: !!item?.already_asked,
              category: item?.category,
              weight_pct: item?.weight_pct,
            }
      );
      setSuggestedQuestionsFromApi(list.slice(0, 10));
    } catch (err) {
      console.error('Partial evaluation fetch failed:', err);
    } finally {
      setQuestionsLoading(false);
    }
  }, [selectedRole]);

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
    savePendingReport(transcript, turns, effectiveRecipientEmail, selectedRole);
    try {
      const result = await evaluateFinal(transcript, turns, selectedRole);
      clearPendingReport();
      setFinalResult(result);
    } catch (err) {
      setFinalResult({ error: err.message });
    } finally {
      setEvaluating(false);
    }
  }, [transcript, turns, effectiveRecipientEmail, selectedRole]);

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
              <button className="btn btn-primary" onClick={handleStart} disabled={evaluating || isStarting}>
                {isStarting ? 'Connecting…' : 'Start recording'}
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
          <FinalReport result={finalResult} transcript={transcript} roleLabel={ROLE_LABELS[selectedRole] || selectedRole} onBack={onEnd} onRetry={handleRetryFinal} />
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
              <p className="questions-panel-hint muted">
                Up to 10 questions by category weight. As the interview proceeds, questions are marked “Asked” when they appear in the transcript and suggestions update. End interview to get the final evaluation and download the report as PDF.
              </p>
              {rubricQuestionsLoading && rubricQuestions.length === 0 ? (
                <p className="muted">Loading questions…</p>
              ) : (
                <SuggestedQuestions
                  questions={(suggestedQuestionsFromApi.length > 0 ? suggestedQuestionsFromApi : rubricQuestions)
                    .slice(0, 10)
                    .map((item) => ({
                      question: item.question,
                      already_asked: !!item.already_asked || questionAskedInTranscript(item.question, transcript),
                      category: item.category,
                      weight_pct: item.weight_pct,
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
    typeof q === 'string'
      ? { question: q, already_asked: false, category: null, weight_pct: null }
      : { question: q?.question ?? '', already_asked: !!q?.already_asked, category: q?.category, weight_pct: q?.weight_pct }
  );
  return (
    <>
      <p className="hint">Click to copy. Gray = already asked; green = still to ask. Weight % = category importance.</p>
      <ul className="question-list">
        {items.map((item, i) => (
          <li key={i} className={item.already_asked ? 'question-asked' : 'question-to-ask'}>
            <span className="question-badge">{item.already_asked ? 'Asked' : 'To ask'}</span>
            {item.category != null && item.weight_pct != null && (
              <span className="question-weight">{item.category} ({item.weight_pct}%)</span>
            )}
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

function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildReportHtml(result, transcript, roleLabel) {
  const titleRole = roleLabel || 'Interview';
  const score = result.weighted_overall_score != null ? Number(result.weighted_overall_score).toFixed(1) : '—';
  const rec = escapeHtml(result.hire_recommendation || '—');
  const summary = escapeHtml(result.summary || '');
  const scores = result.category_scores || [];
  const rows = scores
    .map((r) => `<tr><td style="padding:12px;border:1px solid #d0d7de;">${escapeHtml(r.name)}</td><td style="text-align:center;padding:12px;border:1px solid #d0d7de;">${r.score}</td><td style="padding:12px;border:1px solid #d0d7de;">${escapeHtml(r.justification || '')}</td></tr>`)
    .join('');
  const strengths = (result.strengths || []).map((s) => `<li>${escapeHtml(s)}</li>`).join('') || '<li>None noted</li>';
  const weaknesses = (result.weaknesses || []).map((w) => `<li>${escapeHtml(w)}</li>`).join('') || '<li>None noted</li>';
  const redFlags = (result.red_flags || []).map((f) => `<li>${escapeHtml(f)}</li>`).join('') || '<li>None noted</li>';
  const q = result.questions_coverage || {};
  const asked = (q.asked || []).map((a) => `<li><strong>${escapeHtml(a.category)}:</strong> ${escapeHtml(a.question_or_topic || '')}</li>`).join('') || '<li>—</li>';
  const missed = (q.missed || []).map((m) => {
    const qs = (m.sample_questions_not_asked || []).map((sq) => `<li>${escapeHtml(sq)}</li>`).join('');
    return `<li><strong>${escapeHtml(m.category)}:</strong><ul>${qs}</ul></li>`;
  }).join('') || '<li>—</li>';
  const date = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const fullTranscript = escapeHtml(transcript || '—');
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(titleRole)} — Interview Evaluation Report</title><style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;line-height:1.6;color:#1a1a1a;max-width:720px;margin:0 auto;padding:24px;} table{border-collapse:collapse;width:100%;} th,td{border:1px solid #d0d7de;padding:12px;text-align:left;} th{background:#f6f8fa;}</style></head><body>
<h1>${escapeHtml(titleRole)} — Interview Evaluation Report</h1><p>${date}</p>
<h2>Hire recommendation</h2><p><strong>${rec}</strong></p>
<h2>Weighted overall score</h2><p><strong>${score} / 100</strong></p>
<h2>Category scores (1–5) & justification</h2><table><thead><tr><th>Category</th><th>Score</th><th>Justification</th></tr></thead><tbody>${rows}</tbody></table>
<h2>Strengths</h2><ul>${strengths}</ul>
<h2>Weaknesses</h2><ul>${weaknesses}</ul>
<h2>Red flags</h2><ul>${redFlags}</ul>
<h2>Questions / topics asked</h2><ul>${asked}</ul>
<h2>Questions missed (recommended from rubric)</h2><ul>${missed}</ul>
<h2>Overall summary</h2><p>${summary}</p>
<h2>Full transcript</h2><pre style="background:#f6f8fa;padding:16px;overflow:auto;max-height:400px;">${fullTranscript}</pre>
<p style="margin-top:24px;font-size:12px;color:#57606a;">Generated by Sales Interview Tool</p>
</body></html>`;
}

async function downloadReport(result, transcript, roleLabel) {
  const safeName = (roleLabel || 'Interview').replace(/\s+/g, '-');
  const html = buildReportHtml(result, transcript, roleLabel);
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  const styleMatch = html.match(/<style[^>]*>([\s\S]*?)<\/style>/i);
  const content = (styleMatch ? `<style>${styleMatch[1]}</style>` : '') + (bodyMatch ? bodyMatch[1] : html);

  const wrap = document.createElement('div');
  wrap.style.cssText = 'position:fixed;left:-9999px;top:0;width:794px;background:#fff;padding:24px;box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;';
  wrap.innerHTML = content;
  document.body.appendChild(wrap);

  try {
    await new Promise((r) => setTimeout(r, 100));
    const canvas = await html2canvas(wrap, { scale: 2, useCORS: true, logging: false, width: wrap.offsetWidth, height: wrap.scrollHeight });
    document.body.removeChild(wrap);

    const pdf = new jsPDF('p', 'mm', 'a4');
    const pdfW = 210;
    const pdfH = 297;
    const imgW = pdfW;
    const imgH = (canvas.height * pdfW) / canvas.width;
    const totalPages = Math.ceil(imgH / pdfH);
    const imgData = canvas.toDataURL('image/jpeg', 0.92);

    for (let p = 0; p < totalPages; p++) {
      if (p > 0) pdf.addPage();
      pdf.addImage(imgData, 'JPEG', 0, -p * pdfH, imgW, imgH);
    }
    pdf.save(`${safeName}-Interview-Report-${new Date().toISOString().slice(0, 10)}.pdf`);
  } catch (err) {
    document.body.removeChild(wrap);
    console.error('PDF generation failed:', err);
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${safeName}-Interview-Report-${new Date().toISOString().slice(0, 10)}.html`;
    a.click();
    URL.revokeObjectURL(url);
  }
}

function FinalReport({ result, transcript, roleLabel, onBack, onRetry }) {
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

      <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-primary" onClick={() => downloadReport(result, transcript, roleLabel)}>
          Download report (PDF)
        </button>
        <button className="btn btn-secondary" onClick={onBack}>Back to home</button>
      </div>

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
          <h3>Category scores & justification</h3>
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

      <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem', flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-primary" onClick={() => downloadReport(result, transcript, roleLabel)}>
          Download report (PDF)
        </button>
        <button className="btn btn-secondary" onClick={onBack}>Back to home</button>
      </div>
    </div>
  );
}
