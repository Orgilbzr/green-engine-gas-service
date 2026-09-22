import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";

const exports = {};
const code = ts.transpileModule(
  readFileSync(new URL("../app/dashboard-startup.ts", import.meta.url), "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS } },
).outputText;
new Function("exports", "require", code)(exports, createRequire(import.meta.url));
const { runDashboardStartup } = exports;

// Resolves once both tracked calls have started, so tests can assert both
// requests began before either settles (i.e. neither waits on the other).
function trackedPair({ meDelayMs = 5, bookingsDelayMs = 5, meRejects = false, bookingsRejects = false } = {}) {
  const calls = { me: 0, bookings: 0 };
  const startedAt = { me: null, bookings: null };
  const fetchMe = async (signal) => {
    calls.me += 1;
    startedAt.me = Date.now();
    await delay(meDelayMs, signal);
    if (meRejects) throw new Error("me failed");
    return { user: { role: "operator", email: "op@example.com", name: "Operator" } };
  };
  const fetchBookings = async (signal) => {
    calls.bookings += 1;
    startedAt.bookings = Date.now();
    await delay(bookingsDelayMs, signal);
    if (bookingsRejects) throw new Error("bookings failed");
  };
  return { calls, startedAt, fetchMe, fetchBookings };
}

function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    }, { once: true });
  });
}

test("me and bookings both start immediately, neither waits for the other", async () => {
  const { calls, startedAt, fetchMe, fetchBookings } = trackedPair({ meDelayMs: 30, bookingsDelayMs: 5 });
  const controller = new AbortController();
  const resultPromise = runDashboardStartup({ fetchMe, fetchBookings, signal: controller.signal });
  // Both calls must have been invoked synchronously within the same microtask turn,
  // well before the slower (/api/me) call resolves.
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(calls.me, 1);
  assert.equal(calls.bookings, 1);
  await resultPromise;
  // The booking fetch, which is faster, must have started at roughly the same
  // time as /api/me, not after it resolved.
  assert.ok(Math.abs(startedAt.me - startedAt.bookings) < 15, "bookings must start without waiting for /api/me");
});

test("authenticated + bookings success resolves with the user and no bookings error", async () => {
  const { fetchMe, fetchBookings } = trackedPair();
  const controller = new AbortController();
  const result = await runDashboardStartup({ fetchMe, fetchBookings, signal: controller.signal });
  assert.equal(result.kind, "authenticated");
  assert.equal(result.user.email, "op@example.com");
  assert.equal(result.bookingsError, undefined);
});

test("unauthenticated /api/me (rejected) resolves as unauthenticated", async () => {
  const { fetchMe, fetchBookings } = trackedPair({ meRejects: true });
  const controller = new AbortController();
  const result = await runDashboardStartup({ fetchMe, fetchBookings, signal: controller.signal });
  assert.equal(result.kind, "unauthenticated");
});

test("me resolving without a user is treated as unauthenticated", async () => {
  const fetchMe = async () => ({ user: undefined });
  const fetchBookings = async () => undefined;
  const controller = new AbortController();
  const result = await runDashboardStartup({ fetchMe, fetchBookings, signal: controller.signal });
  assert.equal(result.kind, "unauthenticated");
});

test("bookings failure with a successful auth still resolves authenticated, carrying the bookings error", async () => {
  const { fetchMe, fetchBookings } = trackedPair({ bookingsRejects: true });
  const controller = new AbortController();
  const result = await runDashboardStartup({ fetchMe, fetchBookings, signal: controller.signal });
  assert.equal(result.kind, "authenticated");
  assert.ok(result.bookingsError instanceof Error);
  assert.equal(result.bookingsError.message, "bookings failed");
});

test("bookings fetch is invoked exactly once (no duplicate request)", async () => {
  const { calls, fetchMe, fetchBookings } = trackedPair();
  const controller = new AbortController();
  await runDashboardStartup({ fetchMe, fetchBookings, signal: controller.signal });
  assert.equal(calls.bookings, 1);
  assert.equal(calls.me, 1);
});

test("abort before either settles resolves as aborted with no user/error state to apply", async () => {
  const { fetchMe, fetchBookings } = trackedPair({ meDelayMs: 50, bookingsDelayMs: 50 });
  const controller = new AbortController();
  const resultPromise = runDashboardStartup({ fetchMe, fetchBookings, signal: controller.signal });
  controller.abort();
  const result = await resultPromise;
  assert.equal(result.kind, "aborted");
});

test("abort after a slow /api/me but fast bookings success still resolves as aborted", async () => {
  const { fetchMe, fetchBookings } = trackedPair({ meDelayMs: 50, bookingsDelayMs: 5 });
  const controller = new AbortController();
  const resultPromise = runDashboardStartup({ fetchMe, fetchBookings, signal: controller.signal });
  setTimeout(() => controller.abort(), 15);
  const result = await resultPromise;
  assert.equal(result.kind, "aborted");
});
