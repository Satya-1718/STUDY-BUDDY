const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const L = require("../lib/logic");

describe("streaks", () => {
  test("counts consecutive days ending today", () => {
    assert.deepEqual(L.computeStreaks(["2026-03-01", "2026-03-02", "2026-03-03"], "2026-03-03"), { current: 3, longest: 3 });
  });
  test("streak survives until the day ends (nothing yet today)", () => {
    assert.equal(L.computeStreaks(["2026-03-01", "2026-03-02"], "2026-03-03").current, 2);
  });
  test("streak is broken after a missed day", () => {
    assert.deepEqual(L.computeStreaks(["2026-03-01", "2026-03-02"], "2026-03-04"), { current: 0, longest: 2 });
  });
  test("longest streak is remembered across gaps and month boundaries", () => {
    const r = L.computeStreaks(["2026-02-27", "2026-02-28", "2026-03-01", "2026-03-05"], "2026-03-05");
    assert.deepEqual(r, { current: 1, longest: 3 });
  });
  test("no activity", () => assert.deepEqual(L.computeStreaks([], "2026-03-05"), { current: 0, longest: 0 }));
});

describe("xp and levels", () => {
  test("correct answers earn 10, wrong earn 2", () => assert.equal(L.practiceXp(10, 7), 7 * 10 + 3 * 2));
  test("daily caps stop spamming", () => assert.equal(L.practiceXp(500, 100), 40 * 10 + 20 * 2));
  test("level boundaries", () => {
    assert.equal(L.levelOf(0).level, 1);
    assert.equal(L.levelOf(49).level, 1);
    assert.equal(L.levelOf(50).level, 2);
    assert.deepEqual(L.levelOf(200), { level: 3, levelFloor: 200, levelNext: 450 });
  });
});

describe("student status", () => {
  const now = new Date("2026-03-10T00:00:00Z").getTime();
  test("no activity", () => assert.equal(L.studentStatus({ attempts: 0 }, now), "No activity"));
  test("needs help needs 5+ answers and under 60%", () => {
    assert.equal(L.studentStatus({ attempts: 5, accuracy: 59, lastActive: "2026-03-09" }, now), "Needs help");
    assert.equal(L.studentStatus({ attempts: 4, accuracy: 20, lastActive: "2026-03-09" }, now), "On track");
  });
  test("inactive after 7 days", () => assert.equal(L.studentStatus({ attempts: 9, accuracy: 90, lastActive: "2026-03-01" }, now), "Inactive"));
});

describe("question validation", () => {
  const mcq = { question: "What is a stack?", options: ["LIFO", "FIFO", "LIFO"], answer: "LIFO", topic: "DS" };
  test("accepts a valid MCQ and removes duplicate options", () => {
    const q = L.normalizeQuestion(mcq);
    assert.deepEqual(q.options, ["LIFO", "FIFO"]);
    assert.equal(q.kind, "mcq");
  });
  test("rejects an MCQ whose answer is not one of the options", () => {
    assert.equal(L.normalizeQuestion({ ...mcq, answer: "Tree" }), null);
  });
  test("rejects an MCQ with fewer than 2 distinct options", () => {
    assert.equal(L.normalizeQuestion({ ...mcq, options: ["LIFO", "LIFO"] }), null);
  });
  test("short answer needs a model answer", () => {
    assert.equal(L.normalizeQuestion({ kind: "short", question: "Explain a queue." }), null);
    const q = L.normalizeQuestion({ kind: "short", question: "Explain a queue.", modelAnswer: "First in, first out." });
    assert.equal(q.kind, "short");
    assert.deepEqual(q.options, []);
  });
  test("cleanQuestions names the broken question", () => {
    assert.throws(() => L.cleanQuestions([mcq, { question: "x", options: ["a"], answer: "a" }]), /Question 2 is incomplete/);
  });
  test("cleanQuestions rejects an empty list and an oversized list", () => {
    assert.throws(() => L.cleanQuestions([]), /at least one/);
    assert.throws(() => L.cleanQuestions(Array(31).fill(mcq)), /at most 30/);
  });
});

describe("short answer grading", () => {
  const model = "A stack is a last in first out structure where push and pop happen at the top.";
  test("snapScore snaps to 0, 0.5, 1 and clamps", () => {
    assert.equal(L.snapScore(0.7), 0.5);
    assert.equal(L.snapScore(0.8), 1);
    assert.equal(L.snapScore(3), 1);
    assert.equal(L.snapScore(-2), 0);
    assert.equal(L.snapScore("abc"), null);
  });
  test("fallback gives full marks to a good answer", () => {
    assert.equal(L.fallbackGrade("A stack is last in first out, push and pop at the top", model).score, 1);
  });
  test("fallback gives partial credit and zero", () => {
    assert.equal(L.fallbackGrade("It is a last in first out structure", model).score, 0.5);
    assert.equal(L.fallbackGrade("Bananas are yellow", model).score, 0);
    assert.equal(L.fallbackGrade("", model).score, 0);
  });
  test("fallback is labelled so students know it was not the AI", () => {
    assert.equal(L.fallbackGrade("anything", model).gradedBy, "fallback");
  });
});

describe("exam scoring", () => {
  const qs = [
    { kind: "mcq", topic: "Stacks", answer: "A" },
    { kind: "mcq", topic: "Stacks", answer: "B" },
    { kind: "short", topic: "Queues", answer: "" },
    { kind: "mcq", topic: "Queues", answer: "C" },
  ];
  test("mixes multiple choice and short answer marks", () => {
    const r = L.scoreAnswers(qs, ["A", "X", "some text", "C"], { 2: 0.5 });
    assert.equal(r.score, 2.5);
    assert.equal(r.percent, 63);
    assert.deepEqual(r.marks, [1, 0, 0.5, 1]);
    assert.deepEqual(r.topicBreakdown, [
      { topic: "Stacks", correct: 1, total: 2 },
      { topic: "Queues", correct: 1.5, total: 2 },
    ]);
  });
  test("skipped questions score zero and a missing short score is zero", () => {
    const r = L.scoreAnswers(qs, [null, "", "", ""], {});
    assert.equal(r.score, 0);
  });
  test("a browser cannot score itself: only the stored answer counts", () => {
    assert.equal(L.scoreAnswers([{ kind: "mcq", topic: "t", answer: "A" }], ["B"]).score, 0);
  });
});

describe("csv export", () => {
  test("quotes commas, quotes and newlines", () => {
    assert.equal(L.csvCell('Smith, "Al"'), '"Smith, ""Al"""');
    assert.equal(L.csvCell("a\nb"), '"a\nb"');
  });
  test("neutralises spreadsheet formulas typed into names", () => {
    assert.equal(L.csvCell("=HYPERLINK(\"http://evil\")").startsWith("\"'="), true);
    assert.equal(L.csvCell("+1+1"), "'+1+1");
    assert.equal(L.csvCell("@SUM(A1)"), "'@SUM(A1)");
  });
  test("builds rows with a header and a BOM so Excel reads UTF-8", () => {
    const csv = L.toCsv(["Name", "Score"], [["Asha", 80], ["Ravi, K", null]]);
    assert.equal(csv, '\ufeffName,Score\r\nAsha,80\r\n"Ravi, K",\r\n');
  });
});

describe("rag helpers", () => {
  test("chunkText overlaps and drops tiny pieces", () => {
    const text = ("Sentence number one is here. ").repeat(120);
    const chunks = L.chunkText(text);
    assert.ok(chunks.length > 2);
    assert.ok(chunks.every((c) => c.length <= 950));
  });
  test("cosine", () => {
    assert.ok(Math.abs(L.cosine([1, 0], [1, 0]) - 1) < 1e-9);
    assert.ok(Math.abs(L.cosine([1, 0], [0, 1])) < 1e-9);
  });
});

describe("planner validation", () => {
  const ok = { date: "2026-11-03", title: "  Revise stacks  ", topic: "DS", startTime: "18:30", minutes: 45 };
  test("isDate accepts real days only", () => {
    assert.equal(L.isDate("2026-11-03"), true);
    for (const bad of ["2026-02-30", "2026-13-01", "26-11-03", "2026-11-3", "", null, undefined, 20261103, "2026-11-03T10:00"]) assert.equal(L.isDate(bad), false, String(bad));
  });
  test("isTime", () => {
    assert.equal(L.isTime("00:00"), true); assert.equal(L.isTime("23:59"), true);
    for (const bad of ["24:00", "7:30", "12:60", "noon", "", null]) assert.equal(L.isTime(bad), false, String(bad));
  });
  test("cleanTask trims and keeps valid fields", () => {
    assert.deepEqual(L.cleanTask(ok), { title: "Revise stacks", date: "2026-11-03", topic: "DS", startTime: "18:30", minutes: 45 });
  });
  test("time and duration are optional", () => {
    assert.deepEqual(L.cleanTask({ date: "2026-11-03", title: "Read notes" }), { title: "Read notes", date: "2026-11-03", topic: "", startTime: "", minutes: null });
  });
  test("rejects a missing title, a bad day, a bad time and a bad duration", () => {
    assert.throws(() => L.cleanTask({ ...ok, title: "   " }), /title/);
    assert.throws(() => L.cleanTask({ ...ok, date: "2026-02-30" }), /valid day/);
    assert.throws(() => L.cleanTask({ ...ok, startTime: "25:00" }), /Start time/);
    for (const m of [4, 481, 30.5, "30", -5]) assert.throws(() => L.cleanTask({ ...ok, minutes: m }), /Duration/, String(m));
    assert.throws(() => L.cleanTask(null), /JSON/);
    assert.throws(() => L.cleanTask([]), /JSON/);
  });
  test("long titles are cut, non-string fields are ignored", () => {
    assert.equal(L.cleanTask({ ...ok, title: "x".repeat(500) }).title.length, 120);
    assert.equal(L.cleanTask({ ...ok, topic: { $gt: "" } }).topic, "");
  });
  test("partial edits only check what was sent", () => {
    assert.deepEqual(L.cleanTask({ done: true }, { partial: true }), { done: true });
    assert.deepEqual(L.cleanTask({ minutes: null, startTime: "" }, { partial: true }), { minutes: null, startTime: "" });
    assert.deepEqual(L.cleanTask({}, { partial: true }), {});
    assert.throws(() => L.cleanTask({ done: "yes" }, { partial: true }), /true or false/);
    assert.throws(() => L.cleanTask({ title: "" }, { partial: true }), /title/);
    assert.throws(() => L.cleanTask({ date: "nope" }, { partial: true }), /valid day/);
  });
  test("done cannot be set when creating", () => assert.equal("done" in L.cleanTask({ ...ok, done: true }), false));
  test("range: a year back to two years ahead", () => {
    const now = Date.parse("2026-10-26T12:00:00Z");
    assert.equal(L.inPlannerRange("2026-10-26", now), true);
    assert.equal(L.inPlannerRange("2027-10-26", now), true);
    assert.equal(L.inPlannerRange("2025-11-01", now), true);
    assert.equal(L.inPlannerRange("2020-01-01", now), false);
    assert.equal(L.inPlannerRange("9999-12-31", now), false);
  });
  test("daysBetween", () => { assert.equal(L.daysBetween("2026-10-26", "2026-11-02"), 7); assert.equal(L.daysBetween("2026-03-01", "2026-02-28"), -1); });
  test("tasks sort by day, then time (no time last), then creation", () => {
    const t = [
      { date: "2026-11-04", startTime: "", createdAt: "2026-10-01" },
      { date: "2026-11-03", startTime: "", createdAt: "2026-10-02" },
      { date: "2026-11-03", startTime: "09:00", createdAt: "2026-10-03" },
      { date: "2026-11-03", startTime: "", createdAt: "2026-10-01" },
    ];
    assert.deepEqual(t.sort(L.compareTasks).map((x) => x.date + " " + (x.startTime || "-") + " " + x.createdAt.slice(8)),
      ["2026-11-03 09:00 03", "2026-11-03 - 01", "2026-11-03 - 02", "2026-11-04 - 01"]);
  });
});

describe("AI planner", () => {
  const opts = { goal: "DBMS unit 3: normalisation, transactions", startDate: "2026-11-02", days: 7, minutesPerDay: 90, useWeak: false };
  const now = Date.parse("2026-10-26T10:00:00Z");
  test("options: defaults, trimming and ranges", () => {
    assert.deepEqual(L.cleanGenOptions({ goal: "  Stacks  ", startDate: "2026-11-02" }, now), { goal: "Stacks", useWeak: false, startDate: "2026-11-02", days: 7, minutesPerDay: 60, examDate: "" });
    assert.equal(L.cleanGenOptions({ useWeak: true, startDate: "2026-11-02" }, now).goal, "");
  });
  test("options: rejects bad input", () => {
    assert.throws(() => L.cleanGenOptions({ startDate: "2026-11-02" }, now), /what to cover/);
    assert.throws(() => L.cleanGenOptions({ ...opts, startDate: "soon" }, now), /start day/);
    assert.throws(() => L.cleanGenOptions({ ...opts, startDate: "2031-01-01" }, now), /start day/);
    for (const d of [1, 15, 7.5, "7"]) assert.throws(() => L.cleanGenOptions({ ...opts, days: d }, now), /2 and 14/, String(d));
    for (const m of [10, 500, "60"]) assert.throws(() => L.cleanGenOptions({ ...opts, minutesPerDay: m }, now), /15 to 480/, String(m));
    assert.throws(() => L.cleanGenOptions({ ...opts, examDate: "2026-10-30" }, now), /before your start/);
    assert.throws(() => L.cleanGenOptions({ ...opts, examDate: "2026-02-30" }, now), /not a valid/);
    assert.throws(() => L.cleanGenOptions(null, now), /JSON/);
  });
  test("useWeak must be exactly true", () => assert.throws(() => L.cleanGenOptions({ startDate: "2026-11-02", useWeak: "true" }, now), /what to cover/));
  test("addDaysStr crosses months and years", () => {
    assert.equal(L.addDaysStr("2026-10-30", 3), "2026-11-02"); assert.equal(L.addDaysStr("2026-12-31", 1), "2027-01-01"); assert.equal(L.addDaysStr("2028-02-28", 1), "2028-02-29");
  });
  test("planFromAi maps day numbers to real dates and clamps minutes", () => {
    const r = L.planFromAi({ tasks: [{ day: 2, title: "Solve 10 SQL joins", topic: "DBMS", minutes: 33 }, { day: 1, title: "Read normalisation", topic: "DBMS", minutes: 5 }, { day: 1, title: "Practice", minutes: 999 }] }, opts);
    assert.deepEqual(r.map((t) => [t.date, t.title, t.minutes]), [["2026-11-02", "Read normalisation", 15], ["2026-11-02", "Practice", 180], ["2026-11-03", "Solve 10 SQL joins", 35]]);
    assert.ok(r.every((t) => t.startTime === ""));
  });
  test("planFromAi drops everything unsafe or unusable", () => {
    const junk = [null, 5, "x", { day: 0, title: "a" }, { day: 8, title: "a" }, { day: 1.5, title: "a" }, { day: "two", title: "a" }, { day: 1, title: "" }, { day: 1, title: { $gt: "" } }, { day: 1, title: "   " }, { day: 1, title: "Good one", minutes: "lots" }];
    const r = L.planFromAi({ tasks: junk }, opts);
    assert.deepEqual(r.map((t) => [t.title, t.minutes]), [["Good one", 30]]);
    for (const bad of [null, undefined, "text", 5, {}, { tasks: "nope" }, { tasks: {} }]) assert.deepEqual(L.planFromAi(bad, opts), []);
  });
  test("planFromAi caps 5 tasks per day and 60 in total", () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ day: 1, title: "t" + i }));
    assert.equal(L.planFromAi({ tasks: many }, opts).length, 5);
    const lots = Array.from({ length: 200 }, (_, i) => ({ day: 1 + (i % 14), title: "t" + i }));
    assert.ok(L.planFromAi({ tasks: lots }, { startDate: "2026-11-02", days: 14 }).length <= 60);
  });
  test("planFromAi cuts long titles", () => assert.equal(L.planFromAi({ tasks: [{ day: 1, title: "x".repeat(400) }] }, opts)[0].title.length, 120));
});
