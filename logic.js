// Pure functions only (no database, no network). Everything here is unit tested in test/logic.test.js.

// ---------- Streaks ----------
const prevDay = (s) => { const d = new Date(s + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); };

function computeStreaks(dates, today) {
  const set = new Set(dates);
  let current = 0;
  let cursor = set.has(today) ? today : prevDay(today); // a streak survives until the day ends
  while (set.has(cursor)) { current++; cursor = prevDay(cursor); }
  let longest = 0, run = 0, last = null;
  [...set].sort().forEach((d) => { run = last && prevDay(d) === last ? run + 1 : 1; longest = Math.max(longest, run); last = d; });
  return { current, longest };
}

// ---------- XP and levels ----------
const practiceXp = (count, correct) => Math.min(correct, 40) * 10 + Math.min(count - correct, 20) * 2;
const levelOf = (xp) => { const level = Math.floor(Math.sqrt(xp / 50)) + 1; return { level, levelFloor: 50 * (level - 1) ** 2, levelNext: 50 * level ** 2 }; };

// ---------- Student status shown on the teacher dashboard ----------
function studentStatus({ attempts, accuracy, lastActive }, now = Date.now()) {
  if (!attempts) return "No activity";
  if (attempts >= 5 && accuracy < 60) return "Needs help";
  if (now - new Date(lastActive).getTime() > 7 * 864e5) return "Inactive";
  return "On track";
}

// ---------- Questions: validation ----------
const clean = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");

// Returns a cleaned question, or null if it is unusable. Two kinds:
//   mcq   -> options (2 to 6, distinct) + answer that is one of the options
//   short -> modelAnswer (what a correct answer should contain)
function normalizeQuestion(q) {
  if (!q || typeof q !== "object") return null;
  const kind = q.kind === "short" ? "short" : "mcq";
  const question = clean(q.question, 1000);
  if (!question) return null;
  const base = { kind, topic: clean(q.topic, 80) || "General", question, explanation: clean(q.explanation, 1000) };
  if (kind === "short") {
    const modelAnswer = clean(q.modelAnswer, 1500);
    if (modelAnswer.length < 3) return null;
    return { ...base, options: [], answer: "", modelAnswer };
  }
  const options = [...new Set((Array.isArray(q.options) ? q.options : []).map((o) => clean(o, 300)).filter(Boolean))].slice(0, 6);
  const answer = clean(q.answer, 300);
  if (options.length < 2 || !options.includes(answer)) return null;
  return { ...base, options, answer, modelAnswer: "" };
}

// Strict version used when a teacher edits a draft: explains exactly what is wrong.
function cleanQuestions(arr, max = 30) {
  if (!Array.isArray(arr) || !arr.length) throw new Error("Add at least one question.");
  if (arr.length > max) throw new Error(`An assignment can have at most ${max} questions.`);
  return arr.map((q, i) => {
    const n = normalizeQuestion(q);
    if (!n) {
      const short = q && q.kind === "short";
      throw new Error(`Question ${i + 1} is incomplete. ${short ? "Write the question and a model answer." : "It needs question text, at least 2 different options, and a correct answer that matches one option."}`);
    }
    return n;
  });
}

// ---------- Short-answer grading ----------
const STOP = new Set("a an the is are was were be been being of to in on at for and or but with by from as it its this that these those which who what when where why how do does did can could should would will may might not no yes if then than so such into about over under".split(" "));
const tokens = (s) => String(s || "").toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w));

// Used only when the AI is unavailable: score by how many key words of the model answer appear.
function fallbackGrade(studentAnswer, modelAnswer) {
  const want = [...new Set(tokens(modelAnswer))];
  const have = new Set(tokens(studentAnswer));
  if (!want.length || !have.size) return { score: 0, feedback: "No matching content found. (Auto-graded by keyword match because the AI grader was unavailable.)", gradedBy: "fallback" };
  const hit = want.filter((w) => have.has(w)).length / want.length;
  const score = hit >= 0.6 ? 1 : hit >= 0.3 ? 0.5 : 0;
  return { score, feedback: `Matched ${Math.round(hit * 100)}% of the key terms. (Auto-graded by keyword match because the AI grader was unavailable.)`, gradedBy: "fallback" };
}

// Snap whatever the AI returned to 0, 0.5 or 1.
function snapScore(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return null;
  return Math.round(Math.min(Math.max(x, 0), 1) * 2) / 2;
}

// ---------- Exam scoring ----------
// questions[i] is graded against answers[i]. Short answers use shortScores[i] (0, 0.5 or 1).
function scoreAnswers(questions, answers, shortScores = {}) {
  const breakdown = {};
  let score = 0;
  const marks = questions.map((q, i) => {
    const m = q.kind === "short" ? (shortScores[i] ?? 0) : (answers[i] === q.answer ? 1 : 0);
    score += m;
    const b = breakdown[q.topic] || (breakdown[q.topic] = { topic: q.topic, correct: 0, total: 0 });
    b.total++; b.correct += m;
    return m;
  });
  const total = questions.length;
  return { score, total, percent: total ? Math.round((score / total) * 100) : 0, marks, topicBreakdown: Object.values(breakdown) };
}

// ---------- CSV ----------
// Cells starting with = + - @ are prefixed so Excel/Sheets never run them as formulas
// (student names are typed by students, so they are untrusted).
function csvCell(v) {
  let s = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
const toCsv = (header, rows) => "\ufeff" + [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";

// ---------- Student planner ----------
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// A real calendar day written as YYYY-MM-DD (rejects 2026-02-30)
const isDate = (s) => {
  if (typeof s !== "string" || !DATE_RE.test(s)) return false;
  const t = Date.parse(s + "T00:00:00Z");
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === s; // 2026-02-30 rolls over, 2026-13-01 is NaN
};
const isTime = (s) => typeof s === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
const daysBetween = (a, b) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 864e5);
// Allow tasks from a year ago to two years ahead, so nobody fills the database with year 9999
function inPlannerRange(date, now = Date.now()) {
  const d = daysBetween(new Date(now).toISOString().slice(0, 10), date);
  return d >= -366 && d <= 731;
}

// Validates a planner task. partial=true is for edits: only the fields that were sent are checked.
function cleanTask(b, { partial = false } = {}) {
  if (!b || typeof b !== "object" || Array.isArray(b)) throw new Error("Send the task as JSON.");
  const has = (k) => Object.prototype.hasOwnProperty.call(b, k);
  const out = {};
  if (has("title") || !partial) { const t = clean(b.title, 120); if (!t) throw new Error("Give the task a title."); out.title = t; }
  if (has("date") || !partial) { if (!isDate(b.date)) throw new Error("Pick a valid day."); out.date = b.date; }
  if (has("topic") || !partial) out.topic = clean(b.topic, 60);
  if (has("startTime") || !partial) {
    const t = b.startTime == null ? "" : b.startTime;
    if (t !== "" && !isTime(t)) throw new Error("Start time must look like 18:30.");
    out.startTime = t;
  }
  if (has("minutes") || !partial) {
    const m = b.minutes;
    if (m === null || m === undefined || m === "" || m === 0) out.minutes = null;
    else if (!Number.isInteger(m) || m < 5 || m > 480) throw new Error("Duration must be a whole number of minutes from 5 to 480.");
    else out.minutes = m;
  }
  if (partial && has("done")) { if (typeof b.done !== "boolean") throw new Error("done must be true or false."); out.done = b.done; }
  return out;
}

const addDaysStr = (d, n) => new Date(Date.parse(d + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);

// Options for "plan my days with AI"
function cleanGenOptions(b, now = Date.now()) {
  if (!b || typeof b !== "object" || Array.isArray(b)) throw new Error("Send the options as JSON.");
  const goal = clean(b.goal, 3000);
  const useWeak = b.useWeak === true;
  if (goal.length < 3 && !useWeak) throw new Error("Tell the AI what to cover, or turn on weak topics.");
  if (!isDate(b.startDate) || !inPlannerRange(b.startDate, now)) throw new Error("Pick a valid start day.");
  const days = b.days === undefined ? 7 : b.days;
  if (!Number.isInteger(days) || days < 2 || days > 14) throw new Error("Choose between 2 and 14 days.");
  const minutesPerDay = b.minutesPerDay === undefined ? 60 : b.minutesPerDay;
  if (!Number.isInteger(minutesPerDay) || minutesPerDay < 15 || minutesPerDay > 480) throw new Error("Study time per day must be 15 to 480 minutes.");
  let examDate = "";
  if (b.examDate) {
    if (!isDate(b.examDate)) throw new Error("The exam date is not a valid day.");
    if (b.examDate < b.startDate) throw new Error("The exam date is before your start day.");
    examDate = b.examDate;
  }
  return { goal, useWeak, startDate: b.startDate, days, minutesPerDay, examDate };
}

// Turns the AI's JSON into safe planner tasks. Anything unusable is dropped, never trusted:
// day outside the range, empty title, more than 5 tasks a day, more than 60 in total.
function planFromAi(raw, { startDate, days }) {
  const list = raw && Array.isArray(raw.tasks) ? raw.tasks : [];
  const perDay = {}, out = [];
  for (const t of list) {
    if (!t || typeof t !== "object") continue;
    const day = Number(t.day);
    if (!Number.isInteger(day) || day < 1 || day > days) continue;
    const m = Number(t.minutes);
    const minutes = Number.isFinite(m) ? Math.min(Math.max(Math.round(m / 5) * 5, 15), 180) : 30;
    let task;
    try { task = cleanTask({ date: addDaysStr(startDate, day - 1), title: t.title, topic: t.topic, minutes }); } catch { continue; }
    perDay[task.date] = (perDay[task.date] || 0) + 1;
    if (perDay[task.date] > 5) continue;
    out.push(task);
    if (out.length >= 60) break;
  }
  return out.sort(compareTasks);
}

// Day first, then start time (tasks without a time go last), then the order they were added
const cmp = (x, y) => (x < y ? -1 : x > y ? 1 : 0); // plain comparison: localeCompare ranks "~" before digits
const compareTasks = (a, b) =>
  cmp(a.date, b.date) || cmp(a.startTime || "~", b.startTime || "~") || (new Date(a.createdAt) - new Date(b.createdAt)) || 0;

// ---------- Text helpers for RAG ----------
function chunkText(text, size = 900, overlap = 150) {
  const clean = text.replace(/\r/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  const chunks = [];
  let i = 0;
  while (i < clean.length) {
    let end = Math.min(i + size, clean.length);
    if (end < clean.length) {
      const brk = Math.max(clean.lastIndexOf("\n", end), clean.lastIndexOf(". ", end));
      if (brk > i + size * 0.5) end = brk + 1;
    }
    const piece = clean.slice(i, end).trim();
    if (piece.length > 40) chunks.push(piece);
    if (end >= clean.length) break;
    i = end - overlap;
  }
  return chunks;
}

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

module.exports = {
  prevDay, computeStreaks, practiceXp, levelOf, studentStatus,
  normalizeQuestion, cleanQuestions, fallbackGrade, snapScore, scoreAnswers,
  csvCell, toCsv, chunkText, cosine,
  isDate, isTime, daysBetween, inPlannerRange, cleanTask, compareTasks, addDaysStr, cleanGenOptions, planFromAi,
};
