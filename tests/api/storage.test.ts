import test from "node:test";
import assert from "node:assert/strict";

test("browser storage preserves real conversations and messages regardless of names", async () => {
  const values = new Map<string, string>([
    ["connectsphere_conversations_v2", JSON.stringify([
      { id: "conv-1", type: "direct", name: "Alex Rivera", unreadCount: 0 },
      { id: "conv-2", type: "direct", name: "Sarah Chen", unreadCount: 0 },
    ])],
    ["connectsphere_messages_v2", JSON.stringify({
      "conv-1": [{
        id: "msg-1",
        conversationId: "conv-1",
        senderId: "user-1",
        senderName: "Alex Rivera",
        senderAvatar: "",
        text: "temporary token shares",
        timestamp: "12:00",
        status: "sent",
      }],
    })],
  ]);
  const storageApi = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
  Object.defineProperty(globalThis, "localStorage", { value: storageApi, configurable: true });
  Object.defineProperty(globalThis, "window", { value: {}, configurable: true });

  const { storage } = await import("../../apps/web/src/services/storage.js");

  assert.equal(storage.getConversations().length, 2);
  assert.equal(storage.getConversations()[0]?.name, "Alex Rivera");
  assert.equal(storage.getMessages()["conv-1"]?.[0]?.text, "temporary token shares");
});

test("message drafts are sanitized and isolated by user", async () => {
  const values = new Map<string, string>();
  const storageApi = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
  Object.defineProperty(globalThis, "localStorage", { value: storageApi, configurable: true });

  const { storage } = await import("../../apps/web/src/services/storage.js");
  storage.saveDrafts("user/one", { "conv-1": "unfinished message", "conv-empty": "" });

  assert.deepEqual(storage.getDrafts("user/one"), { "conv-1": "unfinished message" });
  assert.deepEqual(storage.getDrafts("user/two"), {});
  storage.saveDrafts("user/one", {});
  assert.deepEqual(storage.getDrafts("user/one"), {});

  values.set("connectsphere_drafts_v1_malformed", JSON.stringify({
    "conv-1": "valid draft",
    "conv-2": 42,
    "": "missing conversation",
  }));
  assert.deepEqual(storage.getDrafts("malformed"), { "conv-1": "valid draft" });
});

test("message draft storage reports write failures", async () => {
  Object.defineProperty(globalThis, "localStorage", {
    value: {
      getItem: () => null,
      setItem: () => { throw new Error("storage unavailable"); },
      removeItem: () => undefined,
    },
    configurable: true,
  });

  const { storage } = await import("../../apps/web/src/services/storage.js");
  assert.throws(() => storage.saveDrafts("user-1", { "conv-1": "draft" }), /storage unavailable/);
});