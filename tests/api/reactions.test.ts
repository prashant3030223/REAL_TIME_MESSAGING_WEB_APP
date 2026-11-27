import test from "node:test";
import assert from "node:assert/strict";
import { updateMessageReaction } from "../../apps/web/src/services/reactions.js";

test("adding a reaction does not remove a user's other emoji reactions", () => {
  const reactions = updateMessageReaction(
    { "👍": ["user-1", "user-2"], "❤️": ["user-1"], "🙏": ["user-3"] },
    "❤️",
    "user-1",
    true,
  );

  assert.deepEqual(reactions, {
    "👍": ["user-1", "user-2"],
    "❤️": ["user-1"],
    "🙏": ["user-3"],
  });
});

test("a user can add a new emoji reaction when that emoji is not on the message yet", () => {
  const reactions = updateMessageReaction(undefined, "👍", "user-1", true);

  assert.deepEqual(reactions, { "👍": ["user-1"] });
});

test("a user can remove one emoji without removing their other emoji reactions", () => {
  const reactions = updateMessageReaction(
    { "👍": ["user-1", "user-2"], "❤️": ["user-1"] },
    "❤️",
    "user-1",
    false,
  );

  assert.deepEqual(reactions, { "👍": ["user-1", "user-2"] });
});
