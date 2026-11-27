import test from "node:test";
import assert from "node:assert/strict";
import { formatCallTimestamp, formatLastSeen } from "../../apps/web/src/services/time.js";

test("call timestamps show the time for calls today", () => {
  const now = new Date(2026, 10, 27, 12, 0);
  const callTime = new Date(2026, 10, 27, 9, 37);

  assert.equal(
    formatCallTimestamp(callTime.toISOString(), now),
    callTime.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }),
  );
});

test("call timestamps show the weekday earlier this week and a date for older calls", () => {
  const now = new Date(2026, 10, 27, 12, 0);
  const thisWeek = new Date(2026, 10, 25, 16, 0);
  const earlier = new Date(2026, 10, 10, 16, 0);

  assert.equal(
    formatCallTimestamp(thisWeek.toISOString(), now),
    thisWeek.toLocaleDateString([], { weekday: "long" }),
  );
  assert.equal(
    formatCallTimestamp(earlier.toISOString(), now),
    earlier.toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" }),
  );
});

test("last-seen timestamps are shown as elapsed time", () => {
  const now = new Date(2026, 10, 27, 12, 0);
  const lastSeen = new Date(now.getTime() - 5 * 60_000).toISOString();

  assert.equal(formatLastSeen(lastSeen, now), "Last seen 5 minutes ago");
});
