// Boots the real Express app (no database needed: these requests are rejected before any query runs).
// Needs `npm install` first because it uses express and jsonwebtoken.
const { test, before, after, describe } = require("node:test");
const assert = require("node:assert/strict");

process.env.JWT_SECRET = "test-secret";
const jwt = require("jsonwebtoken");
const { app } = require("../server");

let server, base;
before(async () => { await new Promise((r) => { server = app.listen(0, r); }); base = `http://127.0.0.1:${server.address().port}`; });
after(() => new Promise((r) => { if (server.closeAllConnections) server.closeAllConnections(); server.close(r); }));

const as = (role) => ({ Authorization: "Bearer " + jwt.sign({ id: "507f1f77bcf86cd799439011", role }, "test-secret") });
const ID = "507f1f77bcf86cd799439012";

describe("access control over HTTP", () => {
  test("health check is public", async () => {
    const r = await fetch(base + "/health");
    assert.equal(r.status, 200);
  });
  test("no token -> 401", async () => {
    for (const p of ["/api/plan", "/api/profile", "/api/admin/overview", `/api/classes/${ID}/dashboard`]) assert.equal((await fetch(base + p)).status, 401, p);
  });
  test("a garbage token -> 401", async () => {
    assert.equal((await fetch(base + "/api/plan", { headers: { Authorization: "Bearer nope" } })).status, 401);
  });
  test("students cannot reach teacher or department routes", async () => {
    for (const p of [`/api/classes/${ID}/dashboard`, `/api/classes/${ID}/export.csv`, `/api/classes/${ID}/insights`, `/api/assignments/${ID}`, `/api/admin/overview`, "/api/admin/export.csv"])
      assert.equal((await fetch(base + p, { headers: as("student") })).status, 403, p);
  });
  test("teachers cannot reach the department routes", async () => {
    assert.equal((await fetch(base + "/api/admin/overview", { headers: as("teacher") })).status, 403);
  });
  test("a head of department cannot use teacher tools", async () => {
    assert.equal((await fetch(base + `/api/classes/${ID}/insights`, { method: "POST", headers: as("hod") })).status, 403);
    assert.equal((await fetch(base + `/api/assignments/${ID}/publish`, { method: "POST", headers: as("hod") })).status, 403);
  });
  test("students cannot edit or publish assignments", async () => {
    const h = { ...as("student"), "Content-Type": "application/json" };
    assert.equal((await fetch(base + `/api/assignments/${ID}`, { method: "PUT", headers: h, body: "{}" })).status, 403);
    assert.equal((await fetch(base + `/api/assignments/${ID}/publish`, { method: "POST", headers: h })).status, 403);
  });
  test("a head of department cannot sign up without the invite code", async () => {
    delete process.env.HOD_INVITE_CODE;
    const r = await fetch(base + "/api/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "X", email: "x@y.zz", password: "abcdefg1", role: "hod" }) });
    assert.equal(r.status, 403);
  });
});

describe("api docs", () => {
  test("/openapi.json is served and lists the admin routes", async () => {
    const spec = await (await fetch(base + "/openapi.json")).json();
    assert.ok(spec.paths["/api/admin/overview"]);
  });
  test("the docs page is served", async () => {
    const r = await fetch(base + "/api-docs.html");
    assert.equal(r.status, 200);
  });
});
