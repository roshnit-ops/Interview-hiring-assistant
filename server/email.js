import nodemailer from 'nodemailer';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..');

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

function buildHtml(result, transcript) {
  const q = result.questions_coverage || {};
  const asked = q.asked || [];
  const missed = q.missed || [];
  const scores = result.category_scores || [];
  const rows = scores
    .map(
      (r) =>
        `<tr><td>${escapeHtml(r.name)}</td><td>${r.score}</td><td>${escapeHtml(r.justification)}</td></tr>`
    )
    .join('');
  const strengths = (result.strengths || []).map((s) => `<li>${escapeHtml(s)}</li>`).join('');
  const weaknesses = (result.weaknesses || []).map((w) => `<li>${escapeHtml(w)}</li>`).join('');
  const redFlags = (result.red_flags || []).map((f) => `<li>${escapeHtml(f)}</li>`).join('');
  const askedRows = asked
    .map(
      (a) =>
        `<tr><td>${escapeHtml(a.category)}</td><td>${escapeHtml(a.question_or_topic || '')}</td></tr>`
    )
    .join('');
  const missedRows = missed
    .map((m) => {
      const qs = (m.sample_questions_not_asked || [])
        .map((q) => `<li>${escapeHtml(q)}</li>`)
        .join('');
      return `<tr><td>${escapeHtml(m.category)}</td><td><ul>${qs}</ul></td></tr>`;
    })
    .join('');

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>VP of Sales Interview Evaluation</title></head>
<body style="font-family: system-ui, sans-serif; line-height: 1.5; max-width: 720px; margin: 0 auto; padding: 1rem;">
  <h1>VP of Sales — Interview Evaluation</h1>
  <p><strong>Hire recommendation:</strong> ${escapeHtml(result.hire_recommendation || '—')}</p>
  <p><strong>Weighted overall score:</strong> ${result.weighted_overall_score != null ? Number(result.weighted_overall_score).toFixed(1) : '—'} / 100</p>

  <h2>Summary</h2>
  <p>${escapeHtml(result.summary || '')}</p>

  <h2>Category scores (1–5) & justification</h2>
  <table border="1" cellpadding="8" cellspacing="0" style="width:100%; border-collapse: collapse;">
    <thead><tr><th>Category</th><th>Score</th><th>Justification</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>

  <h2>Strengths</h2>
  <ul>${strengths || '<li>None noted</li>'}</ul>

  <h2>Weaknesses</h2>
  <ul>${weaknesses || '<li>None noted</li>'}</ul>

  <h2>Red flags</h2>
  <ul>${redFlags || '<li>None noted</li>'}</ul>

  <h2>Questions coverage (vs. rubric)</h2>
  <h3>Questions / topics asked</h3>
  <table border="1" cellpadding="8" cellspacing="0" style="width:100%; border-collapse: collapse;">
    <thead><tr><th>Category</th><th>What was asked / discussed</th></tr></thead>
    <tbody>${askedRows || '<tr><td colspan="2">—</td></tr>'}</tbody>
  </table>
  <h3>Questions missed (recommended from rubric)</h3>
  <table border="1" cellpadding="8" cellspacing="0" style="width:100%; border-collapse: collapse;">
    <thead><tr><th>Category</th><th>Sample questions not asked</th></tr></thead>
    <tbody>${missedRows || '<tr><td colspan="2">—</td></tr>'}</tbody>
  </table>

  <h2>Full transcript</h2>
  <pre style="white-space: pre-wrap; background: #f5f5f5; padding: 1rem; max-height: 400px; overflow-y: auto;">${escapeHtml(transcript || '')}</pre>
</body>
</html>`;
}

function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export async function sendEvaluationEmail(result, transcript) {
  const to = getEnvKey('RECIPIENT_EMAIL') || 'roshni.t@interface.ai';
  const host = getEnvKey('SMTP_HOST');
  const port = getEnvKey('SMTP_PORT');
  const user = getEnvKey('SMTP_USER');
  const pass = getEnvKey('SMTP_PASS');
  const secure = getEnvKey('SMTP_SECURE') === 'true';

  if (!host || !user || !pass) {
    console.warn('Email not sent: SMTP not configured (set SMTP_HOST, SMTP_USER, SMTP_PASS in .env)');
    return;
  }

  const transporter = nodemailer.createTransport({
    host: host || 'smtp.gmail.com',
    port: port ? parseInt(port, 10) : 587,
    secure: !!secure,
    auth: { user, pass },
  });

  const html = buildHtml(result, transcript);
  await transporter.sendMail({
    from: user,
    to,
    subject: 'VP of Sales — Interview Evaluation',
    html,
  });
  console.log('Evaluation email sent to', to);
}
