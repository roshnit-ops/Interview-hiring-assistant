import sgMail from '@sendgrid/mail';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const FALLBACK_EMAIL = 'fallback@company.com';

function getEnvKey(varName) {
  try {
    const projectRoot = join(__dirname, '..', '..');
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

function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildHtml(result, transcript, turns) {
  const score = result.weighted_overall_score != null ? Number(result.weighted_overall_score).toFixed(1) : '—';
  const rec = escapeHtml(result.hire_recommendation || '—');
  const summary = escapeHtml(result.summary || '');
  const scores = result.category_scores || [];
  const rows = scores
    .map((r) => `<tr>
      <td style="padding: 12px; border: 1px solid #d0d7de;">${escapeHtml(r.name)}</td>
      <td style="text-align: center; padding: 12px; border: 1px solid #d0d7de;">${r.score}</td>
      <td style="padding: 12px; border: 1px solid #d0d7de;">${escapeHtml(r.justification || '')}</td>
    </tr>`)
    .join('');
  const strengths = (result.strengths || []).map((s) => `<li>${escapeHtml(s)}</li>`).join('') || '<li>None noted</li>';
  const weaknesses = (result.weaknesses || []).map((w) => `<li>${escapeHtml(w)}</li>`).join('') || '<li>None noted</li>';
  const redFlags = (result.red_flags || []).map((f) => `<li>${escapeHtml(f)}</li>`).join('') || '<li>None noted</li>';
  const q = result.questions_coverage || {};
  const asked = q.asked || [];
  const missed = q.missed || [];
  const askedHtml = asked.length > 0
    ? asked.map((a) => `<li><strong>${escapeHtml(a.category)}:</strong> ${escapeHtml(a.question_or_topic || '')}</li>`).join('')
    : '<li>—</li>';
  const missedHtml = missed.length > 0
    ? missed.map((m) => {
        const qs = (m.sample_questions_not_asked || []).map((q) => `<li>${escapeHtml(q)}</li>`).join('');
        return `<li><strong>${escapeHtml(m.category)}:</strong><ul>${qs}</ul></li>`;
      }).join('')
    : '<li>—</li>';
  const fullTranscript = escapeHtml(transcript || '—');
  const date = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>VP of Sales Interview Evaluation</title>
</head>
<body style="margin:0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #1a1a1a; background: #f6f8fa;">
  <div style="max-width: 720px; margin: 0 auto; padding: 32px 24px; background: #ffffff; box-shadow: 0 1px 3px rgba(0,0,0,0.08);">
    <div style="border-bottom: 3px solid #0969da; padding-bottom: 24px; margin-bottom: 28px;">
      <h1 style="margin: 0 0 8px; font-size: 24px; font-weight: 700; color: #0969da;">VP of Sales — Interview Evaluation Report</h1>
      <p style="margin: 0; font-size: 14px; color: #57606a;">${date}</p>
    </div>

    <h2 style="margin: 0 0 8px; font-size: 16px; font-weight: 600; color: #1a1a1a;">Hire recommendation</h2>
    <p style="margin: 0 0 24px; font-size: 18px; font-weight: 700;">${rec}</p>

    <h2 style="margin: 0 0 8px; font-size: 16px; font-weight: 600; color: #1a1a1a;">Weighted overall score</h2>
    <p style="margin: 0 0 28px; font-size: 24px; font-weight: 700; color: #0969da;">${score} / 100</p>

    <h2 style="margin: 0 0 12px; font-size: 16px; font-weight: 600; color: #1a1a1a;">Category scores (1–5) &amp; justification</h2>
    <table style="width:100%; border-collapse: collapse; margin-bottom: 28px; font-size: 14px;">
      <thead>
        <tr style="background: #f6f8fa;">
          <th style="text-align: left; padding: 12px; border: 1px solid #d0d7de;">Category</th>
          <th style="text-align: center; padding: 12px; border: 1px solid #d0d7de;">Score</th>
          <th style="text-align: left; padding: 12px; border: 1px solid #d0d7de;">Justification</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>

    <h2 style="margin: 0 0 12px; font-size: 16px; font-weight: 600; color: #1a1a1a;">Summary: strengths, weaknesses &amp; red flags</h2>
    <table style="width:100%; margin-bottom: 28px;">
      <tr>
        <td style="vertical-align: top; padding-right: 24px;">
          <h3 style="margin: 0 0 8px; font-size: 14px; font-weight: 600; color: #1a7f37;">Strengths</h3>
          <ul style="margin: 0; padding-left: 20px; font-size: 14px;">${strengths}</ul>
        </td>
        <td style="vertical-align: top; padding-right: 24px;">
          <h3 style="margin: 0 0 8px; font-size: 14px; font-weight: 600; color: #d29922;">Weaknesses</h3>
          <ul style="margin: 0; padding-left: 20px; font-size: 14px;">${weaknesses}</ul>
        </td>
        <td style="vertical-align: top;">
          <h3 style="margin: 0 0 8px; font-size: 14px; font-weight: 600; color: #cf222e;">Red flags</h3>
          <ul style="margin: 0; padding-left: 20px; font-size: 14px;">${redFlags}</ul>
        </td>
      </tr>
    </table>

    <h2 style="margin: 0 0 12px; font-size: 16px; font-weight: 600; color: #1a1a1a;">Questions coverage (vs. rubric)</h2>
    <h3 style="margin: 0 0 6px; font-size: 14px; font-weight: 600; color: #57606a;">Questions / topics asked</h3>
    <ul style="margin: 0 0 16px; padding-left: 20px; font-size: 14px;">${askedHtml}</ul>
    <h3 style="margin: 0 0 6px; font-size: 14px; font-weight: 600; color: #57606a;">Questions missed (recommended from rubric)</h3>
    <ul style="margin: 0 0 28px; padding-left: 20px; font-size: 14px;">${missedHtml}</ul>

    <h2 style="margin: 0 0 12px; font-size: 16px; font-weight: 600; color: #1a1a1a;">Overall summary</h2>
    <p style="margin: 0 0 28px; font-size: 15px; color: #24292f;">${summary}</p>

    <h2 style="margin: 0 0 12px; font-size: 16px; font-weight: 600; color: #1a1a1a;">Full transcript</h2>
    <div style="background: #f6f8fa; border-radius: 8px; padding: 16px; font-size: 13px; white-space: pre-wrap; max-height: 400px; overflow-y: auto;">${fullTranscript}</div>

    <p style="margin: 24px 0 0; font-size: 12px; color: #57606a;">Generated by Sales Interview Tool</p>
  </div>
</body>
</html>`;
}

export async function sendEvaluationEmail(result, transcript, turns = null, email = null) {
  let toEmail = (typeof email === 'string' && email.trim()) ? email.trim() : null;
  if (!toEmail || !toEmail.includes('@')) {
    toEmail = FALLBACK_EMAIL;
    console.warn('No valid email provided; using fallback:', FALLBACK_EMAIL);
  }
  console.log('Actually sending email to:', toEmail);

  const apiKey = getEnvKey('SENDGRID_API_KEY');
  if (!apiKey) {
    console.warn('SendGrid: SENDGRID_API_KEY not set in .env, skipping email');
    return false;
  }

  sgMail.setApiKey(apiKey);

  // SendGrid requires a verified sender. Default to RECIPIENT_EMAIL if SENDGRID_FROM_EMAIL not set (same as test script).
  const fromEmail = getEnvKey('SENDGRID_FROM_EMAIL') || getEnvKey('RECIPIENT_EMAIL') || 'noreply@example.com';
  const fromName = getEnvKey('SENDGRID_FROM_NAME') || 'Sales Interview Tool';
  const from = fromName ? `${fromName} <${fromEmail}>` : fromEmail;

  const date = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  const subject = `Interview Evaluation Report - VP of Sales - ${date}`;
  let html;
  try {
    html = buildHtml(result, transcript, turns);
  } catch (buildErr) {
    console.error('Failed to build email HTML:', buildErr);
    throw buildErr;
  }

  const msg = {
    to: toEmail,
    from,
    subject,
    html,
  };

  try {
    await sgMail.send(msg);
    return true;
  } catch (err) {
    console.error('SendGrid send error:', err.response?.body?.errors || err.message);
    throw err;
  }
}
