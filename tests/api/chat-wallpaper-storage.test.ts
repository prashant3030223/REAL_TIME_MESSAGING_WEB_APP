import test from "node:test";
import assert from "node:assert/strict";
import { storage } from "../../apps/web/src/services/storage.js";

test("chat wallpapers are saved independently per conversation", () => {
  const originalStorageDescriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const values = new Map<string, string>();
  const localStorageStub = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  } satisfies Pick<Storage, "getItem" | "setItem" | "removeItem">;
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: localStorageStub,
  });

  try {
    values.set("connectsphere_chat_wallpaper_v1", "flow");
    storage.saveChatWallpaper("conversation-a", "aurora");

    assert.equal(storage.getChatWallpaper("conversation-a"), "aurora");
    assert.equal(storage.getChatWallpaper("conversation-b"), "flow");
  } finally {
    if (originalStorageDescriptor) {
      Object.defineProperty(globalThis, "localStorage", originalStorageDescriptor);
    } else {
      Reflect.deleteProperty(globalThis, "localStorage");
    }
  }
});
