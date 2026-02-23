import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..', '..');
const rubricsDir = join(__dirname, '..', 'rubrics');
const GROK_API_URL = 'https://api.x.ai/v1/chat/completions';
const GROK_MODEL = 'grok-4-latest';

const ROLES = [
  { id: 'vp-sales', label: 'VP of Sales' },
  { id: 'vp-ta', label: 'VP of TA' },
  { id: 'account-executive', label: 'Account Executive' },
];

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

function getRubric(roleId) {
  const safe = roleId && ROLES.some((r) => r.id === roleId) ? roleId : 'vp-sales';
  const path = join(rubricsDir, `${safe}.json`);
  if (!existsSync(path)) {
    const fallback = join(__dirname, '..', 'rubric.json');
    if (existsSync(fallback)) {
      return JSON.parse(readFileSync(fallback, 'utf-8'));
    }
    throw new Error(`Rubric not found: ${roleId}`);
  }
  return JSON.parse(readFileSync(path, 'utf-8'));
}

/** GET /api/roles — list available evaluation roles */
export function getRoles(req, res) {
  res.json({ roles: ROLES });
}

/** GET /api/rubric-sample-questions?role=vp-sales — questions with category and weight %, sorted by weight desc */
export function getRubricSampleQuestions(req, res) {
  try {
    const roleId = req.query.role || 'vp-sales';
    const rubric = getRubric(roleId);
    const categories = (rubric.categories || []).slice().sort((a, b) => (b.weight || 0) - (a.weight || 0));
    const questions = categories.flatMap((cat) =>
      (cat.sample_questions || []).map((q) => ({
        category: cat.name,
        weight_pct: Math.round((cat.weight || 0) * 100),
        question: typeof q === 'string' ? q : (q.question || q),
        already_asked: false,
      }))
    );
    res.json({ questions, role: rubric.role });
  } catch (err) {
    console.error('Rubric sample questions error:', err);
    res.status(500).json({ error: err.message || 'Failed to load rubric questions' });
  }
}

function buildPartialSystem(rubric) {
  const roleLabel = rubric.role || 'this role';
  const maxScore = rubric.max_score || 5;
  const categoryList = (rubric.categories || [])
    .sort((a, b) => (b.weight || 0) - (a.weight || 0))
    .map((c) => `"${c.name}" (weight ${Math.round((c.weight || 0) * 100)}%)`)
    .join(', ');
  return `You are an expert interviewer and assessor. You are evaluating a live interview for the role: ${roleLabel}. All suggested questions MUST be for this role only and MUST come from this role's rubric below.

RUBRIC FOR ${roleLabel.toUpperCase()} (use exactly these categories and sample_questions; do not suggest generic or off-rubric questions):
${JSON.stringify(rubric, null, 2)}

Allowed categories for suggested_questions (use exact names): ${categoryList}.

Your job is to analyze the conversation so far and return a JSON object with no other text, no markdown, no code fence—only the raw JSON. Use this exact structure:
{
  "partial_scores": [ { "name": "<category name>", "score": <0-${maxScore} integer>, "justification": "<1-2 sentences>" } ],
  "suggested_questions": [ { "question": "<question text>", "already_asked": <true|false>, "category": "<exact category name from rubric>", "weight_pct": <weight as integer 1-100> }, ... ],
  "red_flags": [ "<flag 1>", ... ],
  "strengths": [ "<strength 1>", ... ],
  "current_impression": "<2-4 sentence summary of how the candidate is doing so far>"
}

Rules:
- partial_scores: one entry per rubric category; score 0-${maxScore} per rubric scoring_guide; justification brief.
- suggested_questions (CRITICAL—adapt to interviewee responses):
  1. Generate questions ONLY from the rubric above for ${roleLabel}. Use each category's criteria and sample_questions; you may rephrase or combine them for follow-ups.
  2. Adapt to the conversation: (a) Where the candidate gave a vague, short, or evasive answer, suggest a follow-up to go deeper on that dimension. (b) Where a dimension is well covered, suggest questions for dimensions not yet covered or weakly covered. (c) Prioritize higher-weight categories first; order the list by category weight (highest first).
  3. Each entry must have "category" set to one of the exact category names from the rubric and "weight_pct" set to that category's weight as an integer (e.g. 45 for 0.45). Set already_asked to true only if the transcript clearly shows this question or topic was already asked; otherwise false.
  4. Prefer behavioral/situational questions (e.g. "Tell me about a time...", "Walk me through..."). Return up to 10 questions; fewer only if transcript is very short.
- red_flags, strengths, current_impression: as above.
- If transcript is empty or very short, return neutral scores and suggested questions drawn from the rubric's sample_questions for ${roleLabel} (with category and weight_pct), ordered by weight descending.
- Output only valid JSON, nothing else.`;
}

function buildFinalSystem(rubric) {
  const roleLabel = rubric.role || 'this role';
  const maxScore = rubric.max_score || 5;
  return `You are an expert interviewer and assessor for a ${roleLabel} role. You are producing the FINAL evaluation after the full interview.

RUBRIC (use exact category names and weights for weighted average):
${JSON.stringify(rubric, null, 2)}

Return a single JSON object with no other text, no markdown, no code fence—only the raw JSON. Use this exact structure:
{
  "category_scores": [ { "name": "<category name>", "score": <0-${maxScore} number>, "justification": "<detailed 2-5 sentences per category>" } ],
  "weighted_overall_score": <number 0-100, one decimal>,
  "hire_recommendation": "Strong Hire" | "Hire with caveats" | "No Hire",
  "summary": "<3-5 sentence overall summary and recommendation>",
  "strengths": [ "<strength 1>", ... ],
  "weaknesses": [ "<weakness 1>", ... ],
  "red_flags": [ "<red flag 1>", ... ],
  "questions_coverage": {
    "asked": [ { "category": "<rubric category name>", "question_or_topic": "<what was asked or discussed (brief)>" } ],
    "missed": [ { "category": "<rubric category name>", "sample_questions_not_asked": [ "<question from rubric>", ... ] } ]
  }
}

Rules:
- weighted_overall_score: MUST be computed from category_scores and rubric weights. Formula: weighted_sum = sum(category_score * category_weight) for each category; then (weighted_sum / ${maxScore}) * 100. Round to one decimal. The rubric uses max_score ${maxScore} for each category.
- hire_recommendation, category_scores, strengths, weaknesses, red_flags, summary, questions_coverage: as before. Use exact category names from the rubric.
- Output only valid JSON, nothing else.`;
}

function computeWeightedScore(categoryScores, rubric) {
  const maxScore = rubric.max_score || 5;
  const byName = new Map((rubric.categories || []).map((c) => [c.name, c.weight]));
  let weightedSum = 0;
  for (const row of categoryScores || []) {
    const w = byName.get(row.name);
    if (w != null && row.score != null) weightedSum += Number(row.score) * w;
  }
  return Math.round((weightedSum / maxScore) * 1000) / 10;
}

export async function evaluatePartial(req, res) {
  try {
    const { transcript, role: roleId } = req.body;
    if (typeof transcript !== 'string') {
      return res.status(400).json({ error: 'transcript must be a string' });
    }
    const rubric = getRubric(roleId || 'vp-sales');
    const systemContent = buildPartialSystem(rubric);

    const roleLabel = rubric.role || 'the selected role';
    const raw = await grokChat(
      [
        { role: 'system', content: systemContent },
        {
          role: 'user',
          content: `Role being evaluated: ${roleLabel}.\n\nConversation so far:\n\n${transcript || '(No speech transcribed yet.)'}`,
        },
      ],
      0.3
    );
    if (!raw) {
      return res.status(500).json({ error: 'Empty Grok response' });
    }

    const parsed = extractJson(raw);
    const categoryByWeight = new Map((rubric.categories || []).map((c) => [c.name, { name: c.name, weight: c.weight }]));
    if (Array.isArray(parsed.suggested_questions)) {
      parsed.suggested_questions = parsed.suggested_questions.map((item) => {
        const q = typeof item === 'string' ? { question: item, already_asked: false } : { question: item?.question ?? String(item), already_asked: !!item?.already_asked, category: item?.category, weight_pct: item?.weight_pct };
        if (q.category && categoryByWeight.has(q.category) && (q.weight_pct == null || q.weight_pct === 0)) {
          q.weight_pct = Math.round((categoryByWeight.get(q.category).weight || 0) * 100);
        }
        if (!q.weight_pct && q.category) q.weight_pct = Math.round((categoryByWeight.get(q.category)?.weight || 0) * 100);
        return q;
      });
      parsed.suggested_questions.sort((a, b) => (b.weight_pct || 0) - (a.weight_pct || 0));
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

export async function evaluateFinal(req, res) {
  try {
    const { transcript, turns, role: roleId } = req.body;
    if (typeof transcript !== 'string') {
      return res.status(400).json({ error: 'transcript must be a string' });
    }
    const rubric = getRubric(roleId || 'vp-sales');
    const systemContent = buildFinalSystem(rubric);

    const transcriptForEval =
      transcript.length <= MAX_TRANSCRIPT_CHARS
        ? transcript
        : transcript.slice(-MAX_TRANSCRIPT_CHARS) +
          '\n\n[Note: Earlier part of transcript omitted for length. Above is the final portion of the interview.]';

    const raw = await grokChat(
      [
        { role: 'system', content: systemContent },
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

    parsed.weighted_overall_score = computeWeightedScore(parsed.category_scores, rubric);
    return res.status(200).json(parsed);
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
