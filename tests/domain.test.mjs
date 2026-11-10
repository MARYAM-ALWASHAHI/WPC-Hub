// Unit tests for the domain layer.
import test from "node:test";
import assert from "node:assert/strict";
import * as D from "../js/domain.js";

const meeting = (o = {}) => D.normalizeMeeting({ id: "m1", ref: "M-2026-01", status: "preparation", agenda: [], members: [], ...o });

test("legacy meeting statuses are normalised", () => {
  assert.equal(D.normalizeMeeting({ id: "a", status: "draft" }).status, "preparation");
  assert.equal(D.normalizeMeeting({ id: "a", status: "ready" }).status, "circulated");
  assert.deepEqual(D.normalizeMeeting({ id: "a" }).agenda, []);
});

test("meeting transitions follow the workflow and guards", () => {
  const ctx = { minutes: {}, items: { i1: { ref: "WPC-2026-001" } }, sigDocs: {} };
  assert.deepEqual(D.guardTransition(meeting(), "agenda_issued", ctx), ["Add at least one agenda item."]);
  assert.equal(D.guardTransition(meeting({ agenda: ["i1"] }), "agenda_issued", ctx).length, 0);
  assert.match(D.guardTransition(meeting(), "circulated", ctx)[0], /cannot move/);
});

test("references never reuse a number", () => {
  assert.equal(D.nextRefNumber("item", 2026, 5, ["WPC-2026-003"]), 6);
  assert.equal(D.nextRefNumber("item", 2026, 2, ["WPC-2026-009", "WPC-2025-050"]), 10);
  assert.equal(D.formatRef("item", 2026, 7), "WPC-2026-007");
  assert.equal(D.formatRef("meeting", 2026, 3), "M-2026-03");
});

test("validation rejects incomplete records", () => {
  assert.deepEqual(Object.keys(D.validateItem({})).sort(), ["category", "dept", "owner", "request", "title"]);
  assert.deepEqual(D.validateAction({ text: "Do it", owner: "HR", due: "2026-12-01" }, "2026-11-10"), {});
});
