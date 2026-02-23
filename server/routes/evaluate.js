import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { sendEvaluationEmail } from '../utils/sendEvaluationEmail.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..', '..');
const GROK_API_URL = 'https://api.x.ai/v1/chat/completions';
const GROK_MODEL = 'grok-4-latest';

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

const grokApiKey = getEnvKey('XAI_API_KEY');
if (!grokApiKey) {
  console.error('XAI_API_KEY not found in .env (project root)');
}

async function grokChat(messages, temperature = 0.3) {
  const res = await fetch(GROK_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${grokApiKey}`,
    },
    body: JSON.stringify({
      model: GROK_MODEL,
      messages,
      stream: false,
      temperature,
    }),
  });
  if (!res.ok) {
    const errText = await res.text();
    const err = new Error(errText || `Grok API ${res.status}`);
    err.status = res.status;
    throw err;
  }
  const data = await res.json();
  const raw = data.choices?.[0]?.message?.content;
  return raw;
}

function extractJson(text) {
  const trimmed = (text || '').trim();
  const codeBlock = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = codeBlock ? codeBlock[1].trim() : trimmed;
  return JSON.parse(raw);
}

const rubric = JSON.parse(
  readFileSync(join(__dirname, '..', 'rubric.json'), 'utf-8')
);

/** GET /api/rubric-sample-questions — standard questions from rubric (for display before interview starts). */
export function getRubricSampleQuestions(req, res) {
  try {
    const categories = rubric.categories || [];
    const questions = categories.flatMap((cat) =>
      (cat.sample_questions || []).map((q) => ({ category: cat.name, question: q, already_asked: false }))
    );
    res.json({ questions });
  } catch (err) {
    console.error('Rubric sample questions error:', err);
    res.status(500).json({ error: 'Failed to load rubric questions' });
  }
}

const PARTIAL_SYSTEM = `You are an expert interviewer and assessor for a VP of Sales role. You are evaluating a live interview in real time.

RUBRIC (store in mind; use exact category names and weights):
${JSON.stringify(rubric, null, 2)}

Your job is to analyze the conversation so far and return a JSON object with no other text, no markdown, no code fence—only the raw JSON. Use this exact structure:
{
  "partial_scores": [ { "name": "<category name>", "score": <1-5 integer>, "justification": "<1-2 sentences>" } ],
  "suggested_questions": [ { "question": "<question text>", "already_asked": <true|false> }, ... ],
  "red_flags": [ "<flag 1>", ... ],
  "strengths": [ "<strength 1>", ... ],
  "current_impression": "<2-4 sentence summary of how the candidate is doing so far>"
}

Rules:
- partial_scores: one entry per rubric category; score 1-5 (1=no evidence, 5=strong evidence); justification brief.
- suggested_questions: Return up to 10 specific follow-up questions. Each must have "question" (string) and "already_asked" (boolean). Set already_asked to true if the transcript clearly shows the interviewer has already asked this question or something very similar, or the topic was already discussed. Set to false if not yet asked. Return 10 questions when possible (mix of rubric-based and follow-ups); fewer only if transcript is very short.
- red_flags: any concerns (vague answers, gaps, concerning statements). Empty array if none.
- strengths: notable positives. Empty array if none yet.
- current_impression: overall take so far.
- If transcript is empty or very short, return neutral scores and generic suggested questions from the rubric.
- Output only valid JSON, nothing else.`;

const FINAL_SYSTEM = `You are an expert interviewer and assessor for a VP of Sales role. You are producing the FINAL evaluation after the full interview.

RUBRIC (use exact category names and weights for weighted average; each category has sample_questions):
${JSON.stringify(rubric, null, 2)}

Return a single JSON object with no other text, no markdown, no code fence—only the raw JSON. Use this exact structure:
{
  "category_scores": [ { "name": "<category name>", "score": <1-5 integer>, "justification": "<detailed 2-5 sentences per category>" } ],
  "weighted_overall_score": <number 0-100, integer or one decimal>,
  "hire_recommendation": "Strong Hire" | "Hire with caveats" | "No Hire",
  "summary": "<3-5 sentence overall summary and recommendation>",
  "strengths": [ "<strength 1>", "<strength 2>", ... ],
  "weaknesses": [ "<weakness 1>", ... ],
  "red_flags": [ "<red flag 1>", ... ],
  "questions_coverage": {
    "asked": [ { "category": "<rubric category name>", "question_or_topic": "<what was asked or discussed (brief)>" } ],
    "missed": [ { "category": "<rubric category name>", "sample_questions_not_asked": [ "<exact or paraphrased sample question from rubric>", ... ] } ]
  }
}

Rules:
- weighted_overall_score: convert the rubric weighted average (1-5) to a score out of 100. Formula: sum(category_score * weight) for each category gives 1-5; then (that value / 5) * 100 = score out of 100. Round to one decimal.
- hire_recommendation: use exactly one of "Strong Hire", "Hire with caveats", or "No Hire".
- category_scores: one entry per rubric category; justification must be 2-5 detailed sentences.
- strengths, weaknesses, red_flags: arrays of concise bullet points (2-6 items each). Empty array if none.
- summary: brief overall take and recommendation. Be strict but fair.
- questions_coverage: Infer from the transcript (interviewer + candidate) which rubric areas were probed and which were not. "asked": list each category that was clearly addressed, with a short description of what was asked/discussed. "missed": list each category that was NOT adequately covered, with the relevant sample_questions from the rubric that the interviewer should have asked. Use the exact category names from the rubric.
- Output only valid JSON, nothing else.`;

export async function evaluatePartial(req, res) {
  try {
    const { transcript } = req.body;
    if (typeof transcript !== 'string') {
      return res.status(400).json({ error: 'transcript must be a string' });
    }

    const raw = await grokChat(
      [
        { role: 'system', content: PARTIAL_SYSTEM },
        {
          role: 'user',
          content: `Conversation so far:\n\n${transcript || '(No speech transcribed yet.)'}`,
        },
      ],
      0.3
    );
    if (!raw) {
      return res.status(500).json({ error: 'Empty Grok response' });
    }

    const parsed = extractJson(raw);
    if (Array.isArray(parsed.suggested_questions)) {
      parsed.suggested_questions = parsed.suggested_questions.map((item) =>
        typeof item === 'string'
          ? { question: item, already_asked: false }
          : { question: item?.question ?? String(item), already_asked: !!item?.already_asked }
      );
    }
    return res.json(parsed);
  } catch (err) {
    console.error('Evaluate partial error:', err);
    const is429 = err.status === 429 || (err.message && String(err.message).includes('429'));
    const status = is429 ? 429 : 500;
    const message = is429
      ? 'Grok API rate limit exceeded. Check your x.ai plan.'
      : (err.message || 'Evaluation failed');
    return res.status(status).json({ error: message });
  }
}

const MAX_TRANSCRIPT_CHARS = 36000;

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function getValidEmail(body) {
  const raw = body.email ?? body.recipientEmail;
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed && EMAIL_REGEX.test(trimmed) ? trimmed : null;
}

export async function evaluateFinal(req, res) {
  try {
    const { transcript, turns } = req.body;
    if (typeof transcript !== 'string') {
      return res.status(400).json({ error: 'transcript must be a string' });
    }
    const recipientEmail = getValidEmail(req.body);

    // Use full transcript or last portion for very long interviews to keep API fast
    const transcriptForEval =
      transcript.length <= MAX_TRANSCRIPT_CHARS
        ? transcript
        : transcript.slice(-MAX_TRANSCRIPT_CHARS) +
          '\n\n[Note: Earlier part of transcript omitted for length. Above is the final portion of the interview.]';

    const raw = await grokChat(
      [
        { role: 'system', content: FINAL_SYSTEM },
        {
          role: 'user',
          content: `Full interview transcript:\n\n${transcriptForEval}`,
        },
      ],
      0.2
    );
    if (!raw) {
      console.error('Final evaluation: Grok returned empty content');
      return res.status(500).json({ error: 'Empty Grok response' });
    }

    let parsed;
    try {
      parsed = extractJson(raw);
    } catch (parseErr) {
      console.error('Final evaluation: Invalid JSON from Grok', parseErr);
      return res.status(500).json({ error: 'Invalid evaluation format from AI' });
    }

    const toEmail = recipientEmail;
    let emailSent = false;
    let emailError = null;
    if (toEmail) {
      try {
        emailSent = await sendEvaluationEmail(parsed, transcript, turns, toEmail);
        if (emailSent) console.log('Evaluation email sent to', toEmail);
        else if (!emailError) emailError = 'Resend not configured or send failed. Check RESEND_API_KEY in .env and verify your domain in Resend.';
      } catch (emailErr) {
        emailError = emailErr?.message || 'Failed to send email';
        console.error('Failed to send evaluation email:', emailError);
      }
    }
    return res.status(200).json({ ...parsed, emailSent: !!emailSent, emailError: emailError || undefined });
  } catch (err) {
    console.error('Evaluate final error:', err);
    const is429 = err.status === 429 || (err.message && String(err.message).includes('429'));
    const status = is429 ? 429 : 500;
    const message = is429
      ? 'Grok API rate limit exceeded. Check your x.ai plan.'
      : (err.message || 'Final evaluation failed');
    return res.status(status).json({ error: message });
  }
}
