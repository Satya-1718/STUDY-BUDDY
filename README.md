# AI Study Buddy

An adaptive study platform for students and teachers.

**Stack:** HTML, CSS, JavaScript (frontend) · Node.js + Express (API) · MongoDB + Mongoose · Gemini API

## Features
- **Study:** AI study plans, adaptive quizzes, spaced-repetition review, "Why was I wrong?" AI tutor
- **Chat with your notes (RAG):** upload PDF/TXT, embeddings + similarity search, answers with sources
- **Exams:** timed, server-graded, AI performance report
- **Analytics:** streaks, activity heatmap, accuracy trend, retention curve
- **Planner:** students set their own days (tasks with a day, time and duration, week strip, tick-off, edit, delete, one-tap carry-over) and can also have the AI draft a plan. The AI plan is only a preview: the student unticks what they do not want and nothing is saved until they add it. The 14-day plan from the Study tab can be copied into the planner too
- **Classes:** teacher dashboard, assignments with due dates, teacher-assisted password reset
- **AI class insights:** one click gives a plain-English briefing ("reteach this first"). Only totals go to the AI, never student names
- **Review before publishing:** the AI drafts an assignment, the teacher edits or deletes questions (or adds their own), then publishes. Students never see drafts
- **Short-answer questions:** students type explanations, AI marks them 0 / 0.5 / 1 against a model answer with feedback. If the AI is down, a keyword match is used and labelled as such
- **Export:** class and assignment results as CSV (formula-safe), plus Print / save as PDF from the browser
- **Head of department:** a third, read-only role with department-wide usage across teachers and classes (aggregates only, no student data)
- **Tests and API docs:** `npm test`, and a docs page at `/api-docs` (spec at `/openapi.json`)
- **Gamification:** XP, levels, badges, class leaderboard
- **Security:** bcrypt password hashing, JWT with roles, helmet headers, rate limiting, input validation

## Run locally
1. Install Node.js 18+ and create a free MongoDB Atlas cluster (or run MongoDB locally).
2. Copy `.env.example` to `.env` and fill in `MONGO_URI`, `GEMINI_API_KEY`, `JWT_SECRET`.
3. `npm install`
4. `npm start`
5. Open http://localhost:3000

## Deploy online (Render + Atlas)
1. Push this folder to a GitHub repository. `.gitignore` already keeps `.env` and `node_modules` out.
2. In MongoDB Atlas, open **Network Access** and allow `0.0.0.0/0` (Render's IP addresses change).
3. On render.com create a **Web Service** from your repository:
   - Build command: `npm install`
   - Start command: `node server.js`
4. Add these **environment variables** in Render:

   | Name | Value |
   |---|---|
   | `MONGO_URI` | your Atlas connection string (with `/studybuddy` before the `?`) |
   | `GEMINI_API_KEY` | your Gemini key |
   | `JWT_SECRET` | a long random text (never reuse your local one) |
   | `TEACHER_INVITE_CODE` | a secret word for teacher sign-ups |
   | `HOD_INVITE_CODE` | a secret word for the head of department (leave unset to disable HOD sign-up) |
   | `DEMO_MODE` | `false` |

5. Deploy, then open the `https://...onrender.com` link. `/health` should return `{"ok":true}`.

Notes:
- Free Render services sleep when idle. The first visit after a pause takes about 30 to 60 seconds, so open the link once before presenting.
- If you set `USE_ATLAS_VECTOR=true`, create the Atlas Vector Search index `vector_index` first (see the project notes).
- Never commit `.env` or paste real keys into screenshots.

## Tests
`npm test` uses Node's built-in test runner (no extra packages).
- `test/logic.test.js`: grading, short-answer fallback, streaks, XP, question validation, CSV safety
- `test/routes.test.js`: every route in `server.js` must be documented in `openapi.js`, and every route must have the right login/role guard (reads the source, needs no database)
- `test/api.test.js`: boots the real app and checks 401/403 over HTTP (run `npm install` first; needs no database)

When you add a route, add it to `openapi.js` too, or `npm test` fails.

## Roles
- **Student:** study, quizzes, exams, notes, assignments, leaderboard
- **Teacher:** classes, dashboard, AI insights, assignments (draft, review, publish) and results, CSV export, student password reset. Registration needs `TEACHER_INVITE_CODE` when it is set.
- **Head of department:** department overview and exports. Registration **always** needs `HOD_INVITE_CODE`; if it is not set, nobody can register as HOD.
