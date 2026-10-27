// OpenAPI 3 description of the AI Study Buddy API. Served at /openapi.json and rendered at /api-docs.
// test/openapi.test.js fails if a route in server.js is missing here (or documented but not implemented).

const paths = {};
const T = { string: { type: "string" }, integer: { type: "integer" }, number: { type: "number" }, boolean: { type: "boolean" }, array: { type: "array", items: {} }, object: { type: "object" } };
const fields = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === "string" ? T[v] || { type: "string", description: v } : v]));

function op(method, path, tag, summary, o = {}) {
  const parameters = [...path.matchAll(/\{(\w+)\}/g)].map((m) => ({ name: m[1], in: "path", required: true, schema: { type: "string" } }));
  if (o.query) Object.entries(o.query).forEach(([name, description]) => parameters.push({ name, in: "query", required: false, description, schema: { type: "string" } }));
  const roles = o.roles || (o.public ? [] : ["student", "teacher", "hod"]);
  const responses = { 200: { description: o.ok || "OK" } };
  if (o.body) responses[400] = { description: "Invalid input. The body is { error }." };
  if (!o.public) responses[401] = { description: "Missing or invalid token." };
  if (roles.length && roles.length < 3 && !o.public) responses[403] = { description: `Only for: ${roles.join(", ")}.` };
  if (parameters.some((p) => p.in === "path")) responses[404] = { description: "Not found (or not yours)." };
  (paths[path] = paths[path] || {})[method] = {
    tags: [tag], summary, description: o.desc,
    security: o.public ? [] : [{ bearerAuth: [] }],
    "x-roles": roles,
    parameters: parameters.length ? parameters : undefined,
    requestBody: o.body ? { required: true, content: { "application/json": { schema: { type: "object", properties: fields(o.body), required: o.required } } } } : undefined,
    responses,
  };
}

const T_ = ["teacher"], S_ = ["student"], H_ = ["hod"];

// ---- Accounts ----
op("post", "/api/register", "Accounts", "Create an account", { public: true, body: { name: "string", email: "string", password: "string", role: "student | teacher | hod", inviteCode: "Needed for teacher (if TEACHER_INVITE_CODE is set) and always for hod (HOD_INVITE_CODE)" }, required: ["name", "email", "password"], ok: "{ token, name, role }" });
op("post", "/api/login", "Accounts", "Log in", { public: true, body: { email: "string", password: "string" }, required: ["email", "password"], ok: "{ token, name, role, mustChange }" });
op("post", "/api/change-password", "Accounts", "Change your password", { body: { currentPassword: "string", newPassword: "string" }, required: ["currentPassword", "newPassword"], ok: "{ token, role }" });
op("get", "/api/profile", "Accounts", "XP, level, streak and badges", { query: { tz: "IANA time zone, e.g. Asia/Kolkata" } });

// ---- Study ----
op("post", "/api/plan", "Study", "Generate a 14-day study plan from a syllabus (AI)", { body: { subject: "string", syllabus: "string" }, required: ["syllabus"] });
op("get", "/api/plan", "Study", "Latest study plan");
op("patch", "/api/plan/{planId}/day/{day}", "Study", "Tick a plan day done or not done", { body: { done: "boolean" } });
op("post", "/api/quiz", "Study", "Generate 5 multiple-choice questions (AI). Use topic \"adaptive\" for weak spots.", { body: { topic: "string" }, required: ["topic"] });
op("post", "/api/answer", "Study", "Record an answer. The server checks it against the answer key it issued, never the browser.", { body: { question: "string", userAnswer: "string" }, required: ["question", "userAnswer"], ok: "{ correct, box, nextReview }" });
op("get", "/api/review", "Study", "Spaced-repetition cards that are due now");
op("get", "/api/cards/summary", "Study", "Counts of tracked, due and mastered cards");
op("post", "/api/explain", "Study", "AI tutor: why was my answer wrong?", { body: { question: "string", userAnswer: "string", correctAnswer: "string" } });
op("get", "/api/stats", "Study", "Accuracy per topic");
op("get", "/api/analytics", "Study", "Streaks, heatmap, accuracy trend and retention curve", { query: { tz: "IANA time zone" } });

// ---- Planner (students) ----
op("get", "/api/planner", "Planner", "Your own tasks between two days (at most 62 days)", { roles: S_, query: { from: "YYYY-MM-DD, required", to: "YYYY-MM-DD, required" } });
op("post", "/api/planner", "Planner", "Add a task to one of your days", { roles: S_, body: { date: "YYYY-MM-DD", title: "string", topic: "string (optional)", startTime: "HH:MM (optional)", minutes: "integer 5-480 (optional)" }, required: ["date", "title"], desc: "Up to 30 tasks per day and 1000 in total." });
op("post", "/api/planner/generate", "Planner", "AI drafts a day-by-day plan. Nothing is saved: the student reviews it first.", { roles: S_, body: { goal: "What to cover (topics or a pasted syllabus)", startDate: "YYYY-MM-DD", days: "integer 2-14 (default 7)", minutesPerDay: "integer 15-480 (default 60)", examDate: "YYYY-MM-DD (optional)", useWeak: "boolean: give extra time to weak quiz topics" }, required: ["startDate"], ok: "{ tasks: [{ date, title, topic, minutes }], weakTopics, days }", desc: "At most 5 tasks a day and 60 in total. The AI output is validated before it is returned." });
op("post", "/api/planner/bulk", "Planner", "Save the tasks the student kept from an AI draft", { roles: S_, body: { tasks: "array of { date, title, topic, minutes } (1 to 60)" }, required: ["tasks"], ok: "{ added, skipped }", desc: "Days that are already full (30 tasks) are skipped." });
op("post", "/api/planner/import-plan", "Planner", "Copy the 14-day AI study plan from the Study tab into the planner", { roles: S_, body: { startDate: "YYYY-MM-DD, becomes day 1" }, required: ["startDate"], ok: "{ added, skipped, firstDay }", desc: "Importing twice does not create duplicates." });
op("post", "/api/planner/carry-over", "Planner", "Move all unfinished tasks from one day to another", { roles: S_, body: { from: "YYYY-MM-DD", to: "YYYY-MM-DD" }, required: ["from", "to"], ok: "{ moved }" });
op("patch", "/api/planner/{id}", "Planner", "Edit, tick off or move a task. Send only the fields that change.", { roles: S_, body: { title: "string", date: "YYYY-MM-DD", topic: "string", startTime: "HH:MM or empty", minutes: "integer or null", done: "boolean" } });
op("delete", "/api/planner/{id}", "Planner", "Delete a task", { roles: S_ });

// ---- Notes (RAG) ----
op("post", "/api/rag/docs", "Notes (RAG)", "Upload notes as text or a base64 PDF and index them", { body: { title: "string", text: "string", pdfBase64: "string" } });
op("get", "/api/rag/docs", "Notes (RAG)", "List your documents");
op("delete", "/api/rag/docs/{id}", "Notes (RAG)", "Delete a document and its chunks");
op("post", "/api/rag/ask", "Notes (RAG)", "Ask a question, answered only from your notes, with sources", { body: { question: "string", docId: "string" }, required: ["question"] });
op("post", "/api/rag/quiz", "Notes (RAG)", "Quiz generated from one of your documents", { body: { docId: "string" }, required: ["docId"] });

// ---- Exams ----
op("post", "/api/exam/start", "Exams", "Start a timed exam (multiple choice, optionally with short-answer questions)", { body: { topic: "string", docId: "string", count: "integer", minutes: "integer", shortCount: "integer" }, desc: "Answers stay on the server. shortCount is limited to half of count." });
op("post", "/api/exam/{id}/submit", "Exams", "Submit answers. Multiple choice is graded by the server; short answers are graded by AI against the model answer.", { body: { answers: "array" }, required: ["answers"] });
op("get", "/api/exam/history", "Exams", "Your submitted exams");
op("get", "/api/exam/{id}/result", "Exams", "Result and review of one submitted exam");

// ---- Classes ----
op("post", "/api/classes", "Classes", "Create a class", { roles: T_, body: { name: "string" }, required: ["name"] });
op("get", "/api/classes", "Classes", "Teachers: their classes. Students: classes they joined.");
op("post", "/api/classes/join", "Classes", "Join a class with its 6-character code", { roles: S_, body: { code: "string" }, required: ["code"] });
op("get", "/api/classes/{id}/leaderboard", "Classes", "XP leaderboard (teacher of the class or a member)");
op("post", "/api/classes/{id}/students/{studentId}/reset-password", "Classes", "Teacher-assisted password reset; returns a temporary password", { roles: T_ });

// ---- Teacher tools ----
op("get", "/api/classes/{id}/dashboard", "Teacher tools", "Class summary, weakest topics and per-student status", { roles: T_ });
op("get", "/api/classes/{id}/export.csv", "Teacher tools", "Download the class report as CSV", { roles: T_, ok: "text/csv" });
op("get", "/api/classes/{id}/insights", "Teacher tools", "Latest saved AI class briefing", { roles: T_ });
op("post", "/api/classes/{id}/insights", "Teacher tools", "Generate a new AI class briefing", { roles: T_, desc: "Only totals are sent to the AI. No student names or emails. Needs 10+ answered questions in the class." });

// ---- Assignments ----
op("post", "/api/classes/{id}/assignments", "Assignments", "AI drafts an assignment. It stays a DRAFT, hidden from students, until published.", { roles: T_, body: { title: "string", topic: "string", count: "integer", minutes: "integer", shortCount: "integer", dueAt: "string" }, required: ["title", "topic", "dueAt"], ok: "{ _id, status: \"draft\" }" });
op("get", "/api/classes/{id}/assignments", "Assignments", "Assignments of a class with submission counts", { roles: T_ });
op("get", "/api/assignments", "Assignments", "Students: published assignments of their classes with status", { roles: S_ });
op("get", "/api/assignments/{id}", "Assignments", "Full assignment with answers, for review (owner only)", { roles: T_ });
op("put", "/api/assignments/{id}", "Assignments", "Edit a draft: title, topic, minutes, due date and the question list. Rejected once published.", { roles: T_, body: { title: "string", topic: "string", minutes: "integer", dueAt: "string", questions: "array" }, required: ["title", "topic", "dueAt", "questions"] });
op("post", "/api/assignments/{id}/publish", "Assignments", "Publish a draft so students can start it", { roles: T_ });
op("delete", "/api/assignments/{id}", "Assignments", "Delete an assignment", { roles: T_ });
op("get", "/api/assignments/{id}/results", "Assignments", "Who submitted and their scores", { roles: T_ });
op("get", "/api/assignments/{id}/export.csv", "Assignments", "Download assignment results as CSV", { roles: T_, ok: "text/csv" });
op("post", "/api/assignments/{id}/start", "Assignments", "Start (or resume) a published assignment as a timed exam", { roles: S_ });

// ---- Head of department ----
op("get", "/api/admin/overview", "Department", "Totals, per-teacher and per-class usage across the department", { roles: H_, desc: "Aggregates only. No individual student data." });
op("get", "/api/admin/export.csv", "Department", "Download department usage as CSV", { roles: H_, query: { view: "teachers (default) or classes" }, ok: "text/csv" });

module.exports = {
  openapi: "3.0.3",
  info: { title: "AI Study Buddy API", version: require("./package.json").version, description: "All /api routes except register and login need `Authorization: Bearer <token>`. Errors look like { \"error\": \"message\" }." },
  tags: ["Accounts", "Study", "Planner", "Notes (RAG)", "Exams", "Classes", "Teacher tools", "Assignments", "Department"].map((name) => ({ name })),
  components: { securitySchemes: { bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" } } },
  paths,
};
