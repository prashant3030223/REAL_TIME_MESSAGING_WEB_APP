import type {
  Conversation,
  Message,
  CallRecord,
  CollaborativeDoc,
  User,
} from "./types.js";
import {
  CHAT_WALLPAPERS,
  CUSTOM_CHAT_WALLPAPER_ID,
  DEFAULT_CHAT_WALLPAPER,
  type ChatWallpaperSelection,
} from "./chatWallpapers.js";

const STORAGE_KEYS = {
  USER: "connectsphere_user_v2",
  CONVERSATIONS: "connectsphere_conversations_v2",
  MESSAGES: "connectsphere_messages_v2",
  CALLS: "connectsphere_calls_v2",
  DOCS: "connectsphere_doc_v2",
  THEME: "connectsphere_theme_v2",
  ACCENT: "connectsphere_accent_v2",
  CHAT_WALLPAPER: "connectsphere_chat_wallpaper_v1",
  CHAT_WALLPAPERS_BY_CONVERSATION: "connectsphere_chat_wallpapers_v2",
  PIN: "connectsphere_app_pin_v2",
  IS_LOCKED: "connectsphere_is_locked_v2",
  ACCESSIBILITY: "connectsphere_accessibility_v2",
  DRAFTS: "connectsphere_drafts_v1",
};

function getUserDraftsStorageKey(userId: string): string {
  return `${STORAGE_KEYS.DRAFTS}_${encodeURIComponent(userId)}`;
}

const CUSTOM_WALLPAPER_DB_NAME = "connectsphere_custom_wallpapers";
const CUSTOM_WALLPAPER_STORE_NAME = "wallpapers";
const CUSTOM_WALLPAPER_RECORD_KEY = "active";

function getConversationWallpaperRecordKey(conversationId: string): string {
  return `conversation:${conversationId}`;
}

function openCustomWallpaperDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("This browser does not support custom wallpaper storage."));
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(CUSTOM_WALLPAPER_DB_NAME, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(CUSTOM_WALLPAPER_STORE_NAME)) {
        database.createObjectStore(CUSTOM_WALLPAPER_STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      reject(request.error ?? new Error("Could not open custom wallpaper storage."));
    };
  });
}

function runCustomWallpaperTransaction<T>(
  mode: IDBTransactionMode,
  requestForStore: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openCustomWallpaperDatabase().then((database) => new Promise((resolve, reject) => {
    const transaction = database.transaction(CUSTOM_WALLPAPER_STORE_NAME, mode);
    let result: T;

    try {
      const request = requestForStore(transaction.objectStore(CUSTOM_WALLPAPER_STORE_NAME));
      request.onsuccess = () => {
        result = request.result;
      };
      request.onerror = () => {
        database.close();
        reject(request.error ?? new Error("Could not access the custom wallpaper."));
      };
    } catch (error) {
      database.close();
      reject(error instanceof Error ? error : new Error("Could not access the custom wallpaper."));
      return;
    }

    transaction.oncomplete = () => {
      database.close();
      resolve(result);
    };
    transaction.onerror = () => {
      database.close();
      reject(transaction.error ?? new Error("Could not save the custom wallpaper."));
    };
    transaction.onabort = () => {
      database.close();
      reject(transaction.error ?? new Error("Custom wallpaper storage was interrupted."));
    };
  }));
}

// Auto-purge all legacy mock data from browser localStorage
export function purgeLegacyMockData(): void {
  if (typeof window === "undefined") return;
  try {
    // Purge legacy mock data
    localStorage.removeItem("connectsphere_user_v1");
    localStorage.removeItem("connectsphere_conversations_v1");
    localStorage.removeItem("connectsphere_messages_v1");
    localStorage.removeItem("connectsphere_calls_v1");
    localStorage.removeItem("connectsphere_doc_v1");
    localStorage.removeItem("connectsphere_code_v1");
    localStorage.removeItem("connectsphere_code_v2");
  } catch { }
}

purgeLegacyMockData();

export type AccessibilitySettings = {
  reducedMotion: boolean;
  highContrast: boolean;
  soundFeedback: boolean;
};

export const defaultAccessibility: AccessibilitySettings = {
  reducedMotion: false,
  highContrast: false,
  soundFeedback: true,
};

const EMPTY_DOC: CollaborativeDoc = {
  id: "doc-1",
  title: "Shared Notes",
  content: "",
  updatedAt: "Just now",
  tasks: [],
  activeAuthors: [{ name: "You", color: "#10b981" }],
};

export const storage = {
  getDrafts(userId: string): Record<string, string> {
    if (!userId.trim()) return {};
    try {
      const stored = localStorage.getItem(getUserDraftsStorageKey(userId));
      if (!stored) return {};

      const parsed: unknown = JSON.parse(stored);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};

      return Object.fromEntries(
        Object.entries(parsed).filter(
          ([conversationId, text]) => conversationId.length > 0 && typeof text === "string" && text.length > 0,
        ),
      );
    } catch {
      return {};
    }
  },

  saveDrafts(userId: string, drafts: Record<string, string>): void {
    if (!userId.trim()) throw new Error("A user is required to save message drafts.");

    const key = getUserDraftsStorageKey(userId);
    const savedDrafts = Object.fromEntries(
      Object.entries(drafts).filter(
        ([conversationId, text]) => conversationId.length > 0 && typeof text === "string" && text.length > 0,
      ),
    );
    if (Object.keys(savedDrafts).length === 0) {
      localStorage.removeItem(key);
      return;
    }
    localStorage.setItem(key, JSON.stringify(savedDrafts));
  },

  getUser(): User | null {
    try {
      const stored = localStorage.getItem(STORAGE_KEYS.USER);
      if (stored) return JSON.parse(stored) as User;
    } catch { }
    return null;
  },

  saveUser(user: User | null): void {
    try {
      if (user) {
        localStorage.setItem(STORAGE_KEYS.USER, JSON.stringify(user));
      } else {
        localStorage.removeItem(STORAGE_KEYS.USER);
        localStorage.removeItem("connectsphere_user_v1");
      }
    } catch { }
  },

  getConversations(): Conversation[] {
    try {
      const stored = localStorage.getItem(STORAGE_KEYS.CONVERSATIONS);
      if (stored) {
        return JSON.parse(stored) as Conversation[];
      }
    } catch { }
    return [];
  },

  saveConversations(conversations: Conversation[]): void {
    try {
      localStorage.setItem(STORAGE_KEYS.CONVERSATIONS, JSON.stringify(conversations));
    } catch { }
  },

  getMessages(): Record<string, Message[]> {
    try {
      const stored = localStorage.getItem(STORAGE_KEYS.MESSAGES);
      if (stored) {
        return JSON.parse(stored) as Record<string, Message[]>;
      }
    } catch { }
    return {};
  },

  saveMessages(messages: Record<string, Message[]>): void {
    try {
      localStorage.setItem(STORAGE_KEYS.MESSAGES, JSON.stringify(messages));
    } catch { }
  },

  getCalls(): CallRecord[] {
    try {
      const stored = localStorage.getItem(STORAGE_KEYS.CALLS);
      if (stored) {
        return JSON.parse(stored) as CallRecord[];
      }
    } catch { }
    return [];
  },

  saveCalls(calls: CallRecord[]): void {
    try {
      localStorage.setItem(STORAGE_KEYS.CALLS, JSON.stringify(calls));
    } catch { }
  },

  getDoc(): CollaborativeDoc {
    try {
      const stored = localStorage.getItem(STORAGE_KEYS.DOCS);
      if (stored) {
        const doc = JSON.parse(stored) as CollaborativeDoc;
        if (
          doc.content === "# ConnectSphere Scratchpad\n\nReal-time collaborative notes and architecture plans across devices."
        ) {
          return {
            ...doc,
            title: doc.title === "Shared Scratchpad" ? "Shared Notes" : doc.title,
            content: "",
          };
        }
        return doc;
      }
    } catch { }
    return EMPTY_DOC;
  },

  saveDoc(doc: CollaborativeDoc): void {
    try {
      localStorage.setItem(STORAGE_KEYS.DOCS, JSON.stringify(doc));
    } catch { }
  },

  getTheme(): "dark" | "light" | "cyber" | "oled" {
    try {
      const stored = localStorage.getItem(STORAGE_KEYS.THEME);
      if (stored === "light" || stored === "cyber" || stored === "oled") return stored;
    } catch { }
    return "dark";
  },

  saveTheme(theme: "dark" | "light" | "cyber" | "oled"): void {
    try {
      localStorage.setItem(STORAGE_KEYS.THEME, theme);
    } catch { }
  },

  getAccent(): string {
    try {
      const stored = localStorage.getItem(STORAGE_KEYS.ACCENT);
      if (stored) return stored;
    } catch { }
    return "emerald";
  },

  saveAccent(accent: string): void {
    try {
      localStorage.setItem(STORAGE_KEYS.ACCENT, accent);
    } catch { }
  },

  getChatWallpaper(conversationId: string): ChatWallpaperSelection {
    try {
      const parsedWallpaperMap = JSON.parse(
        localStorage.getItem(STORAGE_KEYS.CHAT_WALLPAPERS_BY_CONVERSATION) ?? "{}"
      ) as unknown;
      const wallpaperMap = parsedWallpaperMap &&
        typeof parsedWallpaperMap === "object" &&
        !Array.isArray(parsedWallpaperMap)
        ? parsedWallpaperMap as Record<string, unknown>
        : {};
      const savedForConversation = wallpaperMap[conversationId];
      if (savedForConversation === CUSTOM_CHAT_WALLPAPER_ID) return CUSTOM_CHAT_WALLPAPER_ID;
      const savedWallpaper = CHAT_WALLPAPERS.find((wallpaper) => wallpaper.id === savedForConversation);
      if (savedWallpaper) return savedWallpaper.id;

      const legacyWallpaper = localStorage.getItem(STORAGE_KEYS.CHAT_WALLPAPER);
      if (legacyWallpaper === CUSTOM_CHAT_WALLPAPER_ID) return CUSTOM_CHAT_WALLPAPER_ID;
      return CHAT_WALLPAPERS.find((wallpaper) => wallpaper.id === legacyWallpaper)?.id
        ?? DEFAULT_CHAT_WALLPAPER;
    } catch {
      return DEFAULT_CHAT_WALLPAPER;
    }
  },

  saveChatWallpaper(conversationId: string, wallpaper: ChatWallpaperSelection): void {
    try {
      const stored = localStorage.getItem(STORAGE_KEYS.CHAT_WALLPAPERS_BY_CONVERSATION);
      const parsed = stored ? JSON.parse(stored) as Record<string, unknown> : {};
      const wallpaperMap = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
      localStorage.setItem(
        STORAGE_KEYS.CHAT_WALLPAPERS_BY_CONVERSATION,
        JSON.stringify({ ...wallpaperMap, [conversationId]: wallpaper }),
      );
    } catch { }
  },

  getCustomChatWallpaper(conversationId: string): Promise<Blob | null> {
    return runCustomWallpaperTransaction("readonly", (store) =>
      store.get(getConversationWallpaperRecordKey(conversationId))
    ).then((value) => {
      if (value instanceof Blob) return value;
      if (storage.getChatWallpaper(conversationId) !== CUSTOM_CHAT_WALLPAPER_ID) return null;
      return runCustomWallpaperTransaction("readonly", (store) =>
        store.get(CUSTOM_WALLPAPER_RECORD_KEY)
      ).then((legacyValue) => legacyValue instanceof Blob ? legacyValue : null);
    });
  },

  saveCustomChatWallpaper(conversationId: string, wallpaper: Blob): Promise<void> {
    return runCustomWallpaperTransaction("readwrite", (store) =>
      store.put(wallpaper, getConversationWallpaperRecordKey(conversationId))
    ).then(() => undefined);
  },

  removeCustomChatWallpaper(conversationId: string): Promise<void> {
    return runCustomWallpaperTransaction("readwrite", (store) =>
      store.delete(getConversationWallpaperRecordKey(conversationId))
    ).then(() => undefined);
  },

  getAppPin(): string | null {
    try {
      return localStorage.getItem(STORAGE_KEYS.PIN);
    } catch {
      return null;
    }
  },

  saveAppPin(pin: string | null): void {
    try {
      if (pin) localStorage.setItem(STORAGE_KEYS.PIN, pin);
      else localStorage.removeItem(STORAGE_KEYS.PIN);
    } catch { }
  },

  getIsAppLocked(): boolean {
    try {
      return localStorage.getItem(STORAGE_KEYS.IS_LOCKED) === "true";
    } catch {
      return false;
    }
  },

  saveIsAppLocked(isLocked: boolean): void {
    try {
      if (isLocked) localStorage.setItem(STORAGE_KEYS.IS_LOCKED, "true");
      else localStorage.removeItem(STORAGE_KEYS.IS_LOCKED);
    } catch { }
  },

  getAccessibility(): AccessibilitySettings {
    try {
      const stored = localStorage.getItem(STORAGE_KEYS.ACCESSIBILITY);
      if (stored) {
        const settings = JSON.parse(stored) as Partial<AccessibilitySettings>;
        return {
          reducedMotion: settings.reducedMotion === true,
          highContrast: settings.highContrast === true,
          soundFeedback: settings.soundFeedback !== false,
        };
      }
    } catch { }
    return defaultAccessibility;
  },

  saveAccessibility(settings: AccessibilitySettings): void {
    try {
      localStorage.setItem(STORAGE_KEYS.ACCESSIBILITY, JSON.stringify(settings));
    } catch { }
  },

  logout(): void {
    try {
      localStorage.removeItem(STORAGE_KEYS.USER);
    } catch { }
  },
};
