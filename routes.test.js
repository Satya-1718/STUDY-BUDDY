// These tests read server.js as text, so they need no database, no network and no npm install.
const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
const spec = require("../openapi");

// Every `app.<method>("/path", middleware..., handler)` in server.js
const starts = [...source.matchAll(/^app\.(get|post|put|patch|delete)\("(\/[^"]*)",\s*([^\n]*)/gm)];
const routes = starts.map((m, i) => {
  const end = i + 1 < starts.length ? starts[i + 1].index : source.length;
  const middleware = m[3].split(/async|\(req/)[0].split(",").map((x) => x.trim()).filter(Boolean);
  return {
    method: m[1], path: m[2], middleware, body: source.slice(m.index, end),
    key: m[1] + " " + m[2].replace(/:(\w+)/g, "{$1}"),
  };
});
const UNDOCUMENTED = new Set(["get /health", "get /openapi.json", "get /api-docs"]);
const PUBLIC = new Set(["post /api/register", "post /api/login"]);

const documented = [];
for (const [p, ops] of Object.entries(spec.paths)) for (const m of Object.keys(ops)) documented.push({ key: m + " " + p, op: ops[m] });

describe("API docs match the server", () => {
  test("found the routes", () => assert.ok(routes.length > 40, "route parsing broke: " + routes.length));

  test("every route in server.js is documented in openapi.js", () => {
    const docKeys = new Set(documented.map((d) => d.key));
    const missing = routes.filter((r) => !UNDOCUMENTED.has(r.key) && !docKeys.has(r.key)).map((r) => r.key);
    assert.deepEqual(missing, [], "Add these to openapi.js");
  });

  test("everything documented in openapi.js really exists", () => {
    const real = new Set(routes.map((r) => r.key));
    const ghosts = documented.filter((d) => !real.has(d.key)).map((d) => d.key);
    assert.deepEqual(ghosts, [], "Documented but not in server.js");
  });

  test("the spec is valid JSON-serialisable OpenAPI 3", () => {
    const copy = JSON.parse(JSON.stringify(spec));
    assert.equal(copy.openapi, "3.0.3");
    assert.ok(Object.keys(copy.paths).length > 30);
  });
});

describe("permissions", () => {
  test("every /api route except register and login requires a logged-in user", () => {
    const open = routes.filter((r) => r.path.startsWith("/api/") && !PUBLIC.has(r.key) && !r.middleware.includes("auth")).map((r) => r.key);
    assert.deepEqual(open, []);
  });

  test("register and login are the only public API routes", () => {
    const pub = routes.filter((r) => r.path.startsWith("/api/") && !r.middleware.includes("auth")).map((r) => r.key).sort();
    assert.deepEqual(pub, ["post /api/login", "post /api/register"]);
  });

  test("auth always runs before the role check", () => {
    for (const r of routes) {
      const a = r.middleware.indexOf("auth"), t = Math.max(r.middleware.indexOf("teacherOnly"), r.middleware.indexOf("hodOnly"), r.middleware.indexOf("studentOnly"));
      if (t >= 0) assert.ok(a >= 0 && a < t, r.key + " checks the role before logging in");
    }
  });

  test("routes documented as teacher-only use teacherOnly", () => {
    for (const d of documented.filter((d) => JSON.stringify(d.op["x-roles"]) === '["teacher"]')) {
      assert.ok(routes.find((r) => r.key === d.key).middleware.includes("teacherOnly"), d.key + " is documented teacher-only but not protected");
    }
  });

  test("routes documented as hod-only use hodOnly, and only /api/admin uses it", () => {
    for (const d of documented.filter((d) => JSON.stringify(d.op["x-roles"]) === '["hod"]')) {
      assert.ok(routes.find((r) => r.key === d.key).middleware.includes("hodOnly"), d.key + " is documented hod-only but not protected");
    }
    const hodRoutes = routes.filter((r) => r.middleware.includes("hodOnly"));
    assert.ok(hodRoutes.length >= 2);
    assert.ok(hodRoutes.every((r) => r.path.startsWith("/api/admin/")));
    assert.ok(routes.filter((r) => r.path.startsWith("/api/admin/")).every((r) => r.middleware.includes("hodOnly")));
  });

  test("student-only routes check the role inside the handler", () => {
    for (const d of documented.filter((d) => JSON.stringify(d.op["x-roles"]) === '["student"]')) {
      const r = routes.find((x) => x.key === d.key);
      assert.ok(r.middleware.includes("studentOnly") || /req\.role !== "student"/.test(r.body), d.key + " is documented student-only but not protected");
    }
  });

  test("teacher routes that touch a class or assignment check ownership", () => {
    for (const r of routes.filter((r) => r.middleware.includes("teacherOnly") && /:id/.test(r.path))) {
      assert.match(r.body, /ownClass|ownAssignment|teacherId: req\.userId/, r.key + " does not check that the teacher owns it");
    }
  });

  test("the HOD role cannot be self-selected at registration", () => {
    assert.match(source, /HOD_INVITE_CODE/);
    assert.match(source, /Head-of-department sign-up is not enabled/);
  });

  test("students never receive draft assignments or answer keys", () => {
    const list = routes.find((r) => r.key === "get /api/assignments").body;
    assert.match(list, /status: \{ \$ne: "draft" \}/);
    const start = routes.find((r) => r.key === "post /api/assignments/:id/start".replace(/:(\w+)/g, "{$1}")).body;
    assert.match(start, /status === "draft"/);
    assert.doesNotMatch(source.match(/const examPayload[\s\S]*?\}\);/)[0], /q\.answer|q\.modelAnswer/);
  });
});
