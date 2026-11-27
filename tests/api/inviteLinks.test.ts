import assert from "node:assert/strict";
import test from "node:test";
import { createInviteLink, getInviterUsername } from "../../apps/web/src/services/inviteLinks.js";

test("invite link targets the app root and includes the inviter username", () => {
  assert.equal(
    createInviteLink("@Alice_01", "https://connect.example/contacts?tab=users#top"),
    "https://connect.example/?invite=alice_01",
  );
});

test("invite link rejects missing or invalid inviter usernames", () => {
  assert.throws(() => createInviteLink("", "https://connect.example"), /valid username/i);
  assert.throws(() => createInviteLink("not a username", "https://connect.example"), /valid username/i);
});

test("signup reads only valid inviter usernames from the query string", () => {
  assert.equal(getInviterUsername("?invite=%40Alice_01"), "alice_01");
  assert.equal(getInviterUsername("?invite=bad%20username"), null);
  assert.equal(getInviterUsername("?other=alice"), null);
});
