import { useState, useEffect, useRef, useCallback } from "react";
import type { NavTab } from "./components/AppRail.js";
import { AppRail } from "./components/AppRail.js";
import { Header } from "./components/Header.js";
import { QrModal } from "./components/QrModal.js";
import { AppLockModal } from "./components/AppLockModal.js";
import { PwaInstallPrompt } from "./components/PwaInstallPrompt.js";
import { CallModal } from "./components/CallModal.js";
import { IncomingCallModal } from "./components/IncomingCallModal.js";
import { ChatsView } from "./views/ChatsView.js";
import { CallsView } from "./views/CallsView.js";
import { ContactsView } from "./views/ContactsView.js";
import { WorkspaceView } from "./views/WorkspaceView.js";
import { SettingsView } from "./views/SettingsView.js";
import { WhatsAppAuth } from "./views/WhatsAppAuth.js";
import { storage } from "./services/storage.js";
import { soundFx } from "./services/soundFx.js";
import { realtime } from "./services/realtime.js";
import { createUuid } from "./services/ids.js";
import { updateMessageReaction } from "./services/reactions.js";
import type {
  User,
  Conversation,
  Message,
  CallRecord,
  CallParticipant,
  CollaborativeDoc,
  PollData,
} from "./services/types.js";

const messageStatusRank: Record<Message["status"], number> = {
  failed: -1,
  scheduled: -1,
  pending: 0,
  sent: 1,
  delivered: 2,
  read: 3,
};

function advanceMessageStatus(current: Message["status"], next: Message["status"]): Message["status"] {
  return messageStatusRank[next] > messageStatusRank[current] ? next : current;
}

function moveConversationToRecent(
  conversations: Conversation[],
  conversationId: string
): Conversation[] {
  const index = conversations.findIndex((conversation) => conversation.id === conversationId);
  if (index < 0) return conversations;

  const [conversation] = conversations.splice(index, 1);
  if (!conversation) return conversations;

  const insertAt = conversation.isPinned
    ? 0
    : conversations.filter((item) => item.isPinned).length;
  conversations.splice(insertAt, 0, conversation);
  return conversations;
}

export function App() {
  // Navigation & View State
  const [activeTab, setActiveTab] = useState<NavTab>("chats");

  // Domain state
  const [currentUser, setCurrentUser] = useState<User | null>(() => storage.getUser());
  const [isCheckingSession, setIsCheckingSession] = useState(true);
  const [sessionCheckError, setSessionCheckError] = useState<string | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>(() =>
    storage.getConversations().map((conversation) => ({
      ...conversation,
      isOnline: false,
      lastSeen: "Offline",
    }))
  );
  const conversationsRef = useRef(conversations);
  const onlineUserIdsRef = useRef(new Set<string>());
  const onlinePhonesRef = useRef(new Set<string>());
  const [messages, setMessages] = useState<Record<string, Message[]>>(() => storage.getMessages());
  const sentReadReceiptsRef = useRef(new Set<string>());
  const [chatSyncError, setChatSyncError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function restoreSession() {
      try {
        const response = await fetch("/api/auth/me");
        if (response.status === 401) {
          if (!cancelled) {
            setCurrentUser(null);
            storage.saveUser(null);
          }
          return;
        }
        const result = await response.json() as { user?: User; error?: { message?: string } };
        if (!response.ok || !result.user) {
          throw new Error(result.error?.message || "Could not verify your session.");
        }
        if (!cancelled) {
          setCurrentUser(result.user);
          storage.saveUser(result.user);
        }
      } catch (error) {
        if (!cancelled) {
          setSessionCheckError(error instanceof Error ? error.message : "Could not verify your session.");
        }
      } finally {
        if (!cancelled) setIsCheckingSession(false);
      }
    }

    void restoreSession();
    return () => {
      cancelled = true;
    };
  }, []);
  const [activeConversationId, setActiveConversationId] = useState<string>(() => {
    const list = storage.getConversations();
    const requestedConversationId = typeof window === "undefined"
      ? null
      : new URLSearchParams(window.location.search).get("conversation");
    if (requestedConversationId) return requestedConversationId;
    return list.length > 0 && list[0] ? list[0].id : "";
  });
  const [visibleConversationId, setVisibleConversationId] = useState<string | null>(null);
  const visibleConversationIdRef = useRef(visibleConversationId);
  visibleConversationIdRef.current = visibleConversationId;
  const handleVisibleConversationChange = useCallback((conversationId: string | null) => {
    const previousVisibleId = visibleConversationIdRef.current;
    if (previousVisibleId && previousVisibleId !== conversationId) {
      setUnlockedChatIds((previous) => {
        if (!previous.has(previousVisibleId)) return previous;
        const updated = new Set(previous);
        updated.delete(previousVisibleId);
        return updated;
      });
    }
    setVisibleConversationId(conversationId);
  }, []);
  const activeTabRef = useRef(activeTab);
  activeTabRef.current = activeTab;
  const [callHistory, setCallHistory] = useState<CallRecord[]>(() => storage.getCalls());
  const [doc, setDoc] = useState<CollaborativeDoc>(() => storage.getDoc());

  // Themes & Aesthetics
  const [theme, setTheme] = useState<"dark" | "light" | "cyber" | "oled">(() => storage.getTheme());
  const [accent, setAccent] = useState<string>(() => storage.getAccent());
  const [accessibility, setAccessibility] = useState(() => storage.getAccessibility());
  useEffect(() => {
    const unlockSounds = () => {
      soundFx.unlockAudio();
      window.removeEventListener("pointerdown", unlockSounds);
      window.removeEventListener("keydown", unlockSounds);
    };
    window.addEventListener("pointerdown", unlockSounds);
    window.addEventListener("keydown", unlockSounds);
    return () => {
      window.removeEventListener("pointerdown", unlockSounds);
      window.removeEventListener("keydown", unlockSounds);
    };
  }, []);

  useEffect(() => {
    soundFx.setEnabled(accessibility.soundFeedback);
  }, [accessibility.soundFeedback]);
  const [settingsInitialSection, setSettingsInitialSection] = useState<
    "profile" | "security" | "accessibility"
  >("profile");

  // Security & PIN Lock
  const [appPin, setAppPin] = useState<string | null>(() => storage.getAppPin());
  const [isAppLocked, setIsAppLocked] = useState(() => {
    const shouldBeLocked = storage.getIsAppLocked();
    if (shouldBeLocked && !storage.getAppPin()) {
      storage.saveIsAppLocked(false);
      return false;
    }
    return shouldBeLocked;
  });
  const [unlockedChatIds, setUnlockedChatIds] = useState<Set<string>>(new Set());
  const [pendingUnlockChatId, setPendingUnlockChatId] = useState<string | null>(null);

  // Network status & offline outbox
  const [isOnline, setIsOnline] = useState(() =>
    typeof navigator === "undefined" || navigator.onLine
  );
  const outboxQueueRef = useRef(
    Object.values(messages).flat().filter((message) => message.status === "pending")
  );
  const isFlushingOutboxRef = useRef(false);
  const outboxRetryTimerRef = useRef<number | null>(null);
  const outboxRetryDelayRef = useRef(5000);

  // Active Calling & Incoming Call Overlay
  const [isCallModalOpen, setIsCallModalOpen] = useState(false);
  const [isCallEnded, setIsCallEnded] = useState(false);
  const [activeCallId, setActiveCallId] = useState<string | null>(null);
  const callEndedTimerRef = useRef<number | null>(null);
  const [isCallInitiator, setIsCallInitiator] = useState(false);
  const [callAccepted, setCallAccepted] = useState(false);
  const [callParticipants, setCallParticipants] = useState<CallParticipant[]>([]);
  const [incomingCall, setIncomingCall] = useState<{
    callId: string;
    peerName: string;
    peerAvatar: string;
    isVideo: boolean;
    peerUserId?: string;
  } | null>(null);
  const [callPeer, setCallPeer] = useState({
    name: "Peer",
    avatar: "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=400&q=80",
    isVideo: true,
  });

  // Dialogs
  const [isQrModalOpen, setIsQrModalOpen] = useState(false);
  const processedConnectUsernameRef = useRef<string | null>(null);

  // Synchronize CSS body classes for theme, accent, and accessibility
  useEffect(() => {
    document.body.className = `theme-${theme} accent-${accent} ${accessibility.highContrast ? "high-contrast" : ""} ${accessibility.reducedMotion ? "reduced-motion" : ""}`;
  }, [theme, accent, accessibility]);

  useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);

  useEffect(() => {
    const handleOnline = () => {
      outboxRetryDelayRef.current = 5000;
      setIsOnline(true);
    };
    const handleOffline = () => setIsOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    setIsOnline(navigator.onLine);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  useEffect(() => () => {
    if (outboxRetryTimerRef.current !== null) {
      window.clearTimeout(outboxRetryTimerRef.current);
    }
  }, []);

  useEffect(() => {
    if (currentUser && isOnline) void flushOutbox();
  }, [currentUser, isOnline]);

  function applyPresenceToConversation(conversation: Conversation): Conversation {
    const peerPhone = (conversation.peerPhone ?? "").replace(/\D/g, "").slice(-10);
    const isOnline = conversation.type === "direct" && Boolean(
      (conversation.peerUserId && onlineUserIdsRef.current.has(conversation.peerUserId)) ||
      (peerPhone && onlinePhonesRef.current.has(peerPhone))
    );
    return {
      ...conversation,
      isOnline,
      lastSeen: isOnline ? "Online now" : conversation.lastSeen ?? "Offline",
    };
  }

  function deduplicateConversations(conversationList: Conversation[]): Conversation[] {
    const deduplicated: Conversation[] = [];
    const seenDirectPeers = new Set<string>();
    for (const conversation of conversationList) {
      if (conversation.type === "direct" && conversation.peerUserId) {
        if (seenDirectPeers.has(conversation.peerUserId)) continue;
        seenDirectPeers.add(conversation.peerUserId);
      }
      deduplicated.push(conversation);
    }
    return deduplicated;
  }

  function applyPresenceToConversations(items: Conversation[]) {
    return items.map(applyPresenceToConversation);
  }

  useEffect(() => {
    if (
      !currentUser ||
      activeTab !== "chats" ||
      visibleConversationId !== activeConversationId ||
      !activeConversationId
    ) return;
    const activeMessages = (messages[activeConversationId] ?? []).filter(
      (message) => !message.expiresAt || Date.parse(message.expiresAt) > Date.now()
    );
    const unreadIncoming = activeMessages.filter(
      (message) => message.senderId !== currentUser.id && message.status !== "read"
    );
    if (unreadIncoming.length === 0) return;

    const unreadIds = unreadIncoming
      .map((message) => message.id)
      .filter((messageId) => !sentReadReceiptsRef.current.has(messageId));
    if (currentUser.readReceiptsEnabled !== false && unreadIds.length > 0) {
      unreadIds.forEach((messageId) => sentReadReceiptsRef.current.add(messageId));
      realtime.sendReadReceipts(activeConversationId, unreadIds);
    }

    // Mark messages as read locally in messages state & storage
    setMessages((prev) => {
      const list = prev[activeConversationId];
      if (!list) return prev;
      const hasUnread = list.some((m) => m.senderId !== currentUser.id && m.status !== "read");
      if (!hasUnread) return prev;
      const updated = {
        ...prev,
        [activeConversationId]: list.map((m) =>
          m.senderId !== currentUser.id && m.status !== "read"
            ? { ...m, status: "read" as const }
            : m
        ),
      };
      storage.saveMessages(updated);
      return updated;
    });

    setConversations((previous) => {
      if (!previous.some((conversation) =>
        conversation.id === activeConversationId && conversation.unreadCount !== 0
      )) return previous;
      const updated = previous.map((conversation) =>
        conversation.id === activeConversationId && conversation.unreadCount !== 0
          ? { ...conversation, unreadCount: 0 }
          : conversation
      );
      conversationsRef.current = updated;
      storage.saveConversations(updated);
      return updated;
    });

  }, [activeConversationId, activeTab, currentUser, messages, visibleConversationId]);

  useEffect(() => {
    if (!currentUser) return;
    let cancelled = false;

    async function loadPersistentChats() {
      try {
        const readiness = await fetch("/api/health/ready");
        if (!readiness.ok) {
          if (!cancelled) setChatSyncError("PostgreSQL is unavailable. New messages will stay on this device until the server is ready.");
          return;
        }

        const response = await fetch("/api/conversations");
        if (!response.ok) {
          const result = await response.json() as { error?: { message?: string } };
          throw new Error(result.error?.message || "Could not load conversations.");
        }
        const result = await response.json() as { conversations: Conversation[] };
        if (cancelled) return;
        const loadedConversations = deduplicateConversations(
          applyPresenceToConversations(result.conversations ?? [])
        );
        conversationsRef.current = loadedConversations;
        setConversations(loadedConversations);
        storage.saveConversations(loadedConversations);
        setActiveConversationId((current) =>
          loadedConversations.some((conversation) => conversation.id === current)
            ? current
            : loadedConversations[0]?.id ?? ""
        );

        const messageEntries = await Promise.all(
          loadedConversations.map(async (conversation) => {
            const response = await fetch(`/api/conversations/${encodeURIComponent(conversation.id)}/messages`);
            if (!response.ok) {
              const result = await response.json() as { error?: { message?: string } };
              throw new Error(result.error?.message || `Could not load messages for ${conversation.name}.`);
            }
            const result = await response.json() as { messages: Message[] };
            return [conversation.id, result.messages ?? []] as const;
          })
        );
        if (cancelled) return;
        const loadedMessages = Object.fromEntries(messageEntries) as Record<string, Message[]>;
        for (const queuedMessage of outboxQueueRef.current) {
          const conversationMessages = loadedMessages[queuedMessage.conversationId] ?? [];
          if (!conversationMessages.some((message) => message.id === queuedMessage.id)) {
            loadedMessages[queuedMessage.conversationId] = [...conversationMessages, queuedMessage];
          }
        }
        setMessages(loadedMessages);
        storage.saveMessages(loadedMessages);
        setConversations((previous) => {
          const updated = previous.map((conversation) => {
            const queuedMessage = outboxQueueRef.current
              .filter((message) => message.conversationId === conversation.id)
              .at(-1);
            const convMsgs = loadedMessages[conversation.id] ?? [];
            const currentUserId = currentUser?.id;
            const unread = convMsgs.filter(
              (m) => currentUserId ? (m.senderId !== currentUserId && m.status !== "read") : false
            ).length;
            const latestScheduledMessage = convMsgs
              .filter((message) => message.status === "scheduled")
              .at(-1);
            const lastMessage = latestScheduledMessage &&
              (!conversation.lastMessage ||
                Date.parse(latestScheduledMessage.timestamp) >= Date.parse(conversation.lastMessage.timestamp))
              ? latestScheduledMessage
              : conversation.lastMessage;
            return {
              ...conversation,
              unreadCount: unread,
              ...(lastMessage ? { lastMessage } : {}),
              ...(queuedMessage ? { lastMessage: queuedMessage } : {}),
            };
          });
          conversationsRef.current = updated;
          storage.saveConversations(updated);
          return updated;
        });
        setChatSyncError(null);
      } catch (error) {
        if (!cancelled) {
          setChatSyncError(error instanceof Error ? error.message : "Could not synchronize conversations.");
        }
      }
    }

    void loadPersistentChats();
    return () => {
      cancelled = true;
    };
  }, [currentUser]);

  useEffect(() => {
    onlineUserIdsRef.current = new Set();
    onlinePhonesRef.current = new Set();
    if (!currentUser) return;

    const unsubscribe = realtime.subscribe(
      "presence:update",
      (data: { onlineUsers?: Array<{ userId: string; phone?: string }> }) => {
        if (!Array.isArray(data?.onlineUsers)) return;
        const previouslyOnline = onlineUserIdsRef.current;
        onlineUserIdsRef.current = new Set(data.onlineUsers.map((user) => user.userId));
        onlinePhonesRef.current = new Set(
          data.onlineUsers
            .map((user) => (user.phone || "").replace(/\D/g, "").slice(-10))
            .filter(Boolean)
        );
        setConversations((previous) => {
          const disconnectedAt = new Date().toISOString();
          const updated = previous.map((conversation) => {
            const next = applyPresenceToConversation(conversation);
            if (
              conversation.type === "direct" &&
              conversation.peerUserId &&
              previouslyOnline.has(conversation.peerUserId) &&
              !onlineUserIdsRef.current.has(conversation.peerUserId)
            ) {
              next.lastSeen = disconnectedAt;
            }
            return next;
          });
          conversationsRef.current = updated;
          storage.saveConversations(updated);
          return updated;
        });
      }
    );
    return unsubscribe;
  }, [currentUser]);

  // Real-time Gateway Connection and Event Bus Subscriptions
  useEffect(() => {
    if (!currentUser) return;
    realtime.connect(currentUser);

    // Chat Message subscription
    const unsubMsg = realtime.subscribe("chat:message", (incomingMsg: Message) => {
      if (!incomingMsg || !incomingMsg.conversationId) return;
      if (incomingMsg.senderId === currentUser.id) {
        setMessages((previous) => {
          const list = previous[incomingMsg.conversationId];
          const scheduledMessage = list?.find((message) =>
            message.id === incomingMsg.id && message.status === "scheduled"
          );
          if (!list || !scheduledMessage) return previous;
          const updated = {
            ...previous,
            [incomingMsg.conversationId]: list.map((message) =>
              message.id === incomingMsg.id ? { ...incomingMsg, status: "sent" as const } : message
            ),
          };
          storage.saveMessages(updated);
          return updated;
        });
        setConversations((previous) => {
          const updated = previous.map((conversation) =>
            conversation.id === incomingMsg.conversationId &&
            conversation.lastMessage?.id === incomingMsg.id
              ? { ...conversation, lastMessage: { ...incomingMsg, status: "sent" as const } }
              : conversation
          );
          conversationsRef.current = updated;
          storage.saveConversations(updated);
          return updated;
        });
        return;
      }

      const conversationKnown = conversationsRef.current.some(
        (conversation) => conversation.id === incomingMsg.conversationId
      );
      const isConversationVisible = () =>
        activeTabRef.current === "chats" &&
        visibleConversationIdRef.current === incomingMsg.conversationId;

      const isCurrentActive = isConversationVisible();
      const status = isCurrentActive ? "read" : "delivered";

      const msgToStore: Message = {
        ...incomingMsg,
        status: isCurrentActive ? "read" : (incomingMsg.status || "delivered"),
      };

      setMessages((prev) => {
        const convList = prev[incomingMsg.conversationId] ?? [];
        if (convList.some((m) => m.id === incomingMsg.id)) return prev;
        const updated = {
          ...prev,
          [incomingMsg.conversationId]: [...convList, msgToStore],
        };
        storage.saveMessages(updated);
        return updated;
      });

      if (!conversationKnown) {
        void (async () => {
          try {
            const conversationsResponse = await fetch("/api/conversations");
            if (!conversationsResponse.ok) {
              throw new Error("Could not load the conversation for this message.");
            }
            const conversationsResult = await conversationsResponse.json() as { conversations: Conversation[] };
            const conversation = conversationsResult.conversations.map(applyPresenceToConversation).find(
              (item) => item.id === incomingMsg.conversationId
            );
            if (!conversation) {
              throw new Error("Received a message for a conversation that is unavailable to this account.");
            }

            const messagesResponse = await fetch(
              `/api/conversations/${encodeURIComponent(conversation.id)}/messages`
            );
            if (!messagesResponse.ok) {
              throw new Error("Could not load message history for the new conversation.");
            }
            const messagesResult = await messagesResponse.json() as { messages: Message[] };
            const history = messagesResult.messages ?? [];
            const unread = isConversationVisible()
              ? 0
              : history.filter((m) => m.senderId !== currentUser.id && m.status !== "read").length;

            setConversations((previous) => {
              const found = previous.some((item) => item.id === conversation.id);
              const next = found
                ? previous
                : [{
                    ...conversation,
                    lastMessage: msgToStore,
                    unreadCount: unread,
                  }, ...previous];
              if (found) {
                const current = next.map((item) => item.id === conversation.id
                  ? {
                      ...item,
                      lastMessage: msgToStore,
                      unreadCount: unread,
                    }
                  : item);
                moveConversationToRecent(current, conversation.id);
                conversationsRef.current = current;
                storage.saveConversations(current);
                return current;
              }
              moveConversationToRecent(next, conversation.id);
              conversationsRef.current = next;
              storage.saveConversations(next);
              return next;
            });
            setMessages((previous) => {
              const existing = previous[conversation.id] ?? [];
              const messageIds = new Set(existing.map((message) => message.id));
              const nextHistory = history.filter((message) => !messageIds.has(message.id));
              const next = { ...previous, [conversation.id]: [...existing, ...nextHistory] };
              storage.saveMessages(next);
              return next;
            });
          } catch (error) {
            setChatSyncError(error instanceof Error ? error.message : "Could not sync the incoming conversation.");
          }
        })();
      }

      // Update conversation preview snippet & timestamp & accurate unread count
      setConversations((prev) => {
        const updated = prev.map((conv) => {
          if (conv.id === incomingMsg.conversationId) {
            const currentMsgs = storage.getMessages()[conv.id] ?? [];
            const isVisible = isConversationVisible();
            const unread = isVisible
              ? 0
              : currentMsgs.filter(
                  (m) => m.senderId !== currentUser.id && m.status !== "read"
                ).length + (currentMsgs.some((m) => m.id === incomingMsg.id) ? 0 : 1);

            return {
              ...conv,
              lastMessage: msgToStore,
              unreadCount: unread,
            };
          }
          return conv;
        });
        moveConversationToRecent(updated, incomingMsg.conversationId);
        conversationsRef.current = updated;
        storage.saveConversations(updated);
        return updated;
      });

      soundFx.playChatNotification();

      // Return delivered or read status
      if (status === "read" && currentUser.readReceiptsEnabled !== false) {
        sentReadReceiptsRef.current.add(incomingMsg.id);
        realtime.sendReadReceipts(incomingMsg.conversationId, [incomingMsg.id]);
      } else {
        realtime.sendStatus(
          incomingMsg.id,
          incomingMsg.conversationId,
          status === "read" ? "delivered" : status,
        );
      }
    });

    const unsubChatError = realtime.subscribe(
      "chat:error",
      (data: { conversationId?: string; messageId?: string; code?: string }) => {
        if (data?.conversationId && data.messageId) {
          setMessages((previous) => {
            const updated = {
              ...previous,
              [data.conversationId!]: (previous[data.conversationId!] ?? []).map((message) =>
                message.id === data.messageId ? { ...message, status: "failed" as const } : message
              ),
            };
            storage.saveMessages(updated);
            return updated;
          });
        }
        setChatSyncError("The server could not deliver this message. Check the conversation and try again.");
      }
    );

    // Chat Status subscription (delivered / read)
    const unsubStatus = realtime.subscribe("chat:status", (data: { messageId?: string; conversationId?: string; status?: "delivered" | "read" }) => {
      if (!data?.messageId || !data?.status) return;
      const targetId = data.messageId;
      const targetStatus = data.status;

      setMessages((prev) => {
        let changed = false;
        const updated: Record<string, Message[]> = { ...prev };
        const convIds = data.conversationId ? [data.conversationId] : Object.keys(prev);
        for (const cid of convIds) {
          const list = prev[cid];
          if (!list || !list.some((m) => m.id === targetId && m.senderId === currentUser.id)) continue;
          changed = true;
          updated[cid] = list.map((m) =>
            m.id === targetId && m.senderId === currentUser.id
              ? { ...m, status: advanceMessageStatus(m.status, targetStatus) }
              : m
          );
        }
        if (!changed) return prev;
        storage.saveMessages(updated);
        return updated;
      });

      setConversations((prev) => {
        let changed = false;
        const updated = prev.map((c) => {
          if (c.lastMessage && c.lastMessage.id === targetId && c.lastMessage.senderId === currentUser.id) {
            changed = true;
            return {
              ...c,
              lastMessage: {
                ...c.lastMessage,
                status: advanceMessageStatus(c.lastMessage.status, targetStatus),
              },
            };
          }
          return c;
        });
        if (!changed) return prev;
        conversationsRef.current = updated;
        storage.saveConversations(updated);
        return updated;
      });
    });

    const unsubRead = realtime.subscribe("chat:read", (data: {
      messageIds?: string[];
      conversationId?: string;
      status?: "delivered" | "read";
    }) => {
      if (!data?.status || !Array.isArray(data.messageIds) || data.messageIds.length === 0) return;
      const readIds = new Set(data.messageIds);
      const readStatus = data.status;

      setMessages((previous) => {
        let changed = false;
        const updated: Record<string, Message[]> = { ...previous };
        const convIds = data.conversationId ? [data.conversationId] : Object.keys(previous);
        for (const cid of convIds) {
          const list = previous[cid];
          if (!list || !list.some((m) => readIds.has(m.id) && m.senderId === currentUser.id)) continue;
          changed = true;
          updated[cid] = list.map((message) =>
            readIds.has(message.id) && message.senderId === currentUser.id
              ? { ...message, status: advanceMessageStatus(message.status, readStatus) }
              : message
          );
        }
        if (!changed) return previous;
        storage.saveMessages(updated);
        return updated;
      });

      setConversations((prev) => {
        let changed = false;
        const updated = prev.map((c) => {
          if (
            c.lastMessage &&
            readIds.has(c.lastMessage.id) &&
            c.lastMessage.senderId === currentUser.id
          ) {
            changed = true;
            return {
              ...c,
              lastMessage: {
                ...c.lastMessage,
                status: advanceMessageStatus(c.lastMessage.status, readStatus),
              },
            };
          }
          return c;
        });
        if (!changed) return prev;
        conversationsRef.current = updated;
        storage.saveConversations(updated);
        return updated;
      });
    });

    // Chat Sent acknowledgment from server (single checkmark: waiting for recipient)
    const unsubSent = realtime.subscribe("chat:sent", (data: { messageId?: string; conversationId?: string; status?: "sent" }) => {
      if (!data?.messageId) return;
      const targetId = data.messageId;

      setMessages((prev) => {
        let changed = false;
        const updated: Record<string, Message[]> = { ...prev };
        const convIds = data.conversationId ? [data.conversationId] : Object.keys(prev);
        for (const cid of convIds) {
          const list = prev[cid];
          if (!list || !list.some((m) => m.id === targetId)) continue;
          changed = true;
          updated[cid] = list.map((m) =>
            m.id === targetId ? { ...m, status: advanceMessageStatus(m.status, "sent") } : m
          );
        }
        if (!changed) return prev;
        storage.saveMessages(updated);
        return updated;
      });
    });

    // Chat Delivered acknowledgment from server (double checkmark: recipient received it)
    const unsubDelivered = realtime.subscribe("chat:delivered", (data: { messageId?: string; conversationId?: string; status?: "delivered" }) => {
      if (!data?.messageId) return;
      const targetId = data.messageId;

      setMessages((prev) => {
        let changed = false;
        const updated: Record<string, Message[]> = { ...prev };
        const convIds = data.conversationId ? [data.conversationId] : Object.keys(prev);
        for (const cid of convIds) {
          const list = prev[cid];
          if (!list || !list.some((m) => m.id === targetId)) continue;
          changed = true;
          updated[cid] = list.map((m) =>
            m.id === targetId ? { ...m, status: advanceMessageStatus(m.status, "delivered") } : m
          );
        }
        if (!changed) return prev;
        storage.saveMessages(updated);
        return updated;
      });

      setConversations((prev) => {
        let changed = false;
        const updated = prev.map((c) => {
          if (c.lastMessage && c.lastMessage.id === targetId) {
            changed = true;
            return {
              ...c,
              lastMessage: {
                ...c.lastMessage,
                status: advanceMessageStatus(c.lastMessage.status, "delivered"),
              },
            };
          }
          return c;
        });
        if (!changed) return prev;
        conversationsRef.current = updated;
        storage.saveConversations(updated);
        return updated;
      });
    });

    // Realtime message deleted
    const unsubDelete = realtime.subscribe("chat:delete", (data: { messageId: string; conversationId: string; deletedForEveryone?: boolean; deletedBy?: string; ghostUnsend?: boolean }) => {
      if (!data?.messageId || !data?.conversationId) return;
      if (data.ghostUnsend) {
        setMessages((prev) => {
          const list = prev[data.conversationId];
          if (!list) return prev;
          const filtered = list.filter((m) => m.id !== data.messageId);
          const updated = {
            ...prev,
            [data.conversationId]: filtered,
          };
          storage.saveMessages(updated);
          return updated;
        });
        setConversations((prev) => {
          const updated: Conversation[] = prev.map((c) => {
            if (c.id === data.conversationId && c.lastMessage?.id === data.messageId) {
              const { lastMessage: _, ...rest } = c;
              return rest as Conversation;
            }
            return c;
          });
          conversationsRef.current = updated;
          storage.saveConversations(updated);
          return updated;
        });
        return;
      }
      setMessages((prev) => {
        const list = prev[data.conversationId];
        if (!list) return prev;
        const updated = {
          ...prev,
          [data.conversationId]: list.map((m) =>
            m.id === data.messageId
              ? {
                  ...m,
                  isDeleted: true,
                  text: "🚫 This message was deleted",
                  attachments: undefined,
                  voiceNote: undefined,
                  poll: undefined,
                }
              : m
          ),
        };
        storage.saveMessages(updated);
        return updated;
      });
    });

    const unsubEdit = realtime.subscribe(
      "chat:edit",
      (data: { messageId?: string; conversationId?: string; text?: string; isEdited?: boolean }) => {
        if (
          !data?.messageId ||
          !data.conversationId ||
          typeof data.text !== "string" ||
          data.isEdited !== true
        ) return;
        const { messageId, conversationId, text } = data;
        setMessages((previous) => {
          const list = previous[conversationId];
          if (!list?.some((message) => message.id === messageId && !message.isDeleted)) return previous;
          const updated = {
            ...previous,
            [conversationId]: list.map((message) =>
              message.id === messageId ? { ...message, text, isEdited: true } : message
            ),
          };
          storage.saveMessages(updated);
          return updated;
        });
        setConversations((previous) => {
          const updated = previous.map((conversation) =>
            conversation.id === conversationId && conversation.lastMessage?.id === messageId
              ? { ...conversation, lastMessage: { ...conversation.lastMessage, text, isEdited: true } }
              : conversation
          );
          conversationsRef.current = updated;
          storage.saveConversations(updated);
          return updated;
        });
      },
    );

    const unsubDisappearing = realtime.subscribe(
      "chat:disappearing",
      (data: { conversationId?: string; hours?: number }) => {
        if (
          !data?.conversationId ||
          !Number.isInteger(data.hours) ||
          (data.hours as number) < 0 ||
          (data.hours as number) > 720
        ) return;
        const timerHours = data.hours as number;
        setConversations((previous) => {
          const updated = previous.map((conversation) =>
            conversation.id === data.conversationId
              ? { ...conversation, disappearingTimerHours: timerHours }
              : conversation
          );
          conversationsRef.current = updated;
          storage.saveConversations(updated);
          return updated;
        });
      },
    );

    const unsubPin = realtime.subscribe("chat:pin", (data: { messageId: string; conversationId: string; isPinned: boolean }) => {
      if (!data?.messageId || !data?.conversationId || typeof data.isPinned !== "boolean") return;
      setMessages((prev) => {
        const list = prev[data.conversationId];
        if (!list) return prev;
        const updated = {
          ...prev,
          [data.conversationId]: list.map((message) => {
            if (message.id === data.messageId) return { ...message, isPinned: data.isPinned };
            return data.isPinned && message.isPinned ? { ...message, isPinned: false } : message;
          }),
        };
        storage.saveMessages(updated);
        return updated;
      });
    });

    // Realtime message reaction
    const unsubReaction = realtime.subscribe("chat:reaction", (data: { messageId: string; conversationId: string; emoji: string; userId: string; isReacting?: boolean }) => {
      if (!data?.messageId || !data?.conversationId) return;
      setMessages((prev) => {
        const list = prev[data.conversationId];
        if (!list) return prev;
        const updated = {
          ...prev,
          [data.conversationId]: list.map((m) => {
            if (m.id !== data.messageId) return m;
            const isReacting = data.isReacting ?? !(m.reactions?.[data.emoji] ?? []).includes(data.userId);
            return {
              ...m,
              reactions: updateMessageReaction(m.reactions, data.emoji, data.userId, isReacting),
            };
          }),
        };
        storage.saveMessages(updated);
        return updated;
      });
    });

    // Realtime poll vote
    const unsubPollVote = realtime.subscribe("chat:poll_vote", (data: { messageId: string; conversationId: string; poll: PollData }) => {
      if (!data?.messageId || !data?.conversationId || !data.poll) return;
      setMessages((prev) => {
        const list = prev[data.conversationId];
        if (!list) return prev;
        const updated = {
          ...prev,
          [data.conversationId]: list.map((message) =>
            message.id === data.messageId ? { ...message, poll: data.poll } : message
          ),
        };
        storage.saveMessages(updated);
        return updated;
      });
    });

    // Call Invite subscription
    const unsubCallInvite = realtime.subscribe("call:invite", (data: { callId?: string; peerName?: string; peerAvatar?: string; isVideo?: boolean; fromUser?: User }) => {
      if (!data?.callId || data.fromUser?.id === currentUser.id) return;
      clearCallEndedScreen();
      const callerName = data.fromUser?.displayName || data.peerName || "Remote Peer";
      const callerAvatar = data.fromUser?.avatar || data.peerAvatar || "/avatars/boy.png";
      setIncomingCall({
        callId: data.callId,
        peerName: callerName,
        peerAvatar: callerAvatar,
        isVideo: data.isVideo ?? true,
        peerUserId: data.fromUser?.id,
      });
    });

    // Call Unavailable subscription (e.g. user is offline)
    const unsubCallUnavailable = realtime.subscribe("call:unavailable", (data: { callId?: string; reason?: string }) => {
      if (data?.callId !== activeCallId) return;
      soundFx.playCallEnd();
      setIsCallModalOpen(false);
      setActiveCallId(null);
      setCallAccepted(false);
      setIsCallInitiator(false);
      setCallParticipants([]);
      alert(data?.reason || "User is currently offline and cannot receive calls.");
    });

    // Call Accept subscription
    const unsubCallAccept = realtime.subscribe("call:accept", (data: { callId?: string }) => {
      if (data?.callId !== activeCallId) return;
      setCallAccepted(true);
    });

    // Call Decline subscription
    const unsubCallDecline = realtime.subscribe("call:decline", (data: { callId?: string }) => {
      if (data?.callId !== activeCallId) return;
      soundFx.playCallEnd();
      setIncomingCall(null);
      handleCallFinished();
    });

    // Call Hangup subscription
    const unsubCallHangup = realtime.subscribe("call:hangup", (data: { callId?: string }) => {
      if (data?.callId === incomingCall?.callId) setIncomingCall(null);
      if (data?.callId !== activeCallId) return;
      soundFx.playCallEnd();
      setIncomingCall(null);
      handleCallFinished();
    });

    const unsubCallParticipants = realtime.subscribe(
      "call:participants",
      (data: { callId?: string; participants?: CallParticipant[] }) => {
        if (
          (data?.callId !== activeCallId && data?.callId !== incomingCall?.callId) ||
          !Array.isArray(data.participants)
        ) return;
        setCallParticipants(data.participants.filter((participant) => participant.id !== currentUser.id));
      },
    );

    const unsubCallParticipantLeft = realtime.subscribe(
      "call:participant-left",
      (data: { callId?: string; participantId?: string }) => {
        if (
          (data?.callId !== activeCallId && data?.callId !== incomingCall?.callId) ||
          !data.participantId
        ) return;
        setCallParticipants((participants) => participants.filter(({ id }) => id !== data.participantId));
      },
    );

    return () => {
      unsubMsg();
      unsubChatError();
      unsubStatus();
      unsubRead();
      unsubSent();
      unsubDelivered();
      unsubDelete();
      unsubEdit();
      unsubDisappearing();
      unsubPin();
      unsubReaction();
      unsubPollVote();
      unsubCallInvite();
      unsubCallUnavailable();
      unsubCallAccept();
      unsubCallDecline();
      unsubCallHangup();
      unsubCallParticipants();
      unsubCallParticipantLeft();
    };
  }, [currentUser, activeConversationId, activeCallId, incomingCall]);

  function queueMessage(message: Message) {
    if (!outboxQueueRef.current.some((queued) => queued.id === message.id)) {
      outboxQueueRef.current.push({ ...message, status: "pending" });
    }
    setMessages((previous) => {
      const updated = {
        ...previous,
        [message.conversationId]: (previous[message.conversationId] ?? []).map((item) =>
          item.id === message.id ? { ...item, status: "pending" as const } : item
        ),
      };
      storage.saveMessages(updated);
      return updated;
    });
  }

  function scheduleOutboxRetry() {
    if (outboxRetryTimerRef.current !== null) return;
    const delay = outboxRetryDelayRef.current;
    outboxRetryDelayRef.current = Math.min(delay * 2, 60_000);
    outboxRetryTimerRef.current = window.setTimeout(() => {
      outboxRetryTimerRef.current = null;
      if (navigator.onLine) void flushOutbox();
    }, delay);
  }

  async function flushOutbox() {
    if (!currentUser || !navigator.onLine || isFlushingOutboxRef.current) return;
    if (outboxRetryTimerRef.current !== null) {
      window.clearTimeout(outboxRetryTimerRef.current);
      outboxRetryTimerRef.current = null;
    }
    isFlushingOutboxRef.current = true;
    try {
      const pending = outboxQueueRef.current.splice(0);
      for (let index = 0; index < pending.length; index += 1) {
        if (!navigator.onLine) {
          outboxQueueRef.current.unshift(...pending.slice(index));
          break;
        }
        const message = pending[index];
        if (!message) continue;
        const status = await dispatchMessage(message);
        if (status === "pending") {
          outboxQueueRef.current.push(...pending.slice(index + 1));
          break;
        }
      }
      if (outboxQueueRef.current.length === 0) {
        outboxRetryDelayRef.current = 5000;
      }
    } finally {
      isFlushingOutboxRef.current = false;
    }
  }

  async function dispatchMessage(message: Message): Promise<"sent" | "pending" | "failed"> {
    if (!navigator.onLine) {
      queueMessage(message);
      setIsOnline(false);
      return "pending";
    }
    try {
      const { attachments, voiceNote, sharedContact, ...metadata } = message;
      const response = await fetch(`/api/conversations/${encodeURIComponent(message.conversationId)}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: message.id,
          text: message.text,
          idempotencyKey: message.id,
          ...(attachments ? { attachments } : {}),
          ...(voiceNote ? { voiceNote } : {}),
          metadata,
          ...(sharedContact ? { sharedContact } : {}),
        }),
      });
      const result = await response.json() as { message?: Partial<Message>; error?: { message?: string } };
      if (!response.ok || !result.message) {
        throw new Error(result.error?.message || "Message could not be saved.");
      }

      setMessages((previous) => {
        const list = previous[message.conversationId] ?? [];
        const existing = list.find((item) => item.id === message.id);
        const currentStatus = existing?.status ?? message.status;
        const nextStatus = advanceMessageStatus(currentStatus, "sent");
        const savedMessage: Message = {
          ...message,
          ...result.message,
          status: nextStatus,
        };
        const updated = {
          ...previous,
          [message.conversationId]: list.map((item) =>
            item.id === message.id ? savedMessage : item
          ),
        };
        storage.saveMessages(updated);
        return updated;
      });
      setConversations((previous) => {
        const updated = previous.map((conversation) => {
          if (conversation.id === message.conversationId) {
            const currentStatus = conversation.lastMessage?.id === message.id
              ? advanceMessageStatus(conversation.lastMessage.status, "sent")
              : "sent";
            return {
              ...conversation,
              lastMessage: {
                ...message,
                ...result.message,
                status: currentStatus,
              },
            };
          }
          return conversation;
        });
        moveConversationToRecent(updated, message.conversationId);
        storage.saveConversations(updated);
        return updated;
      });
      realtime.sendMessage(message.conversationId, {
        ...message,
        ...result.message,
        status: advanceMessageStatus(message.status, "sent"),
      });
      setChatSyncError(null);
      return "sent";
    } catch (error) {
      const messageText = error instanceof Error ? error.message : "Message could not be saved.";
      setChatSyncError(messageText);
      if (error instanceof TypeError) {
        queueMessage(message);
        setIsOnline(navigator.onLine);
        scheduleOutboxRetry();
        return "pending";
      }
      setMessages((previous) => {
        const updated = {
          ...previous,
          [message.conversationId]: (previous[message.conversationId] ?? []).map((item) =>
            item.id === message.id ? { ...item, status: "failed" as const } : item
          ),
        };
        storage.saveMessages(updated);
        return updated;
      });
      return "failed";
    }
  }

  // Send Message Handler with real-time sync & offline outbox queuing
  async function handleSendMessage(conversationId: string, text: string, extra?: Partial<Message>): Promise<boolean> {
    if (!currentUser) return false;
    const conv = conversations.find((c) => c.id === conversationId);
    const targetUserId = conv?.peerUserId;
    const targetPhone = conv?.peerPhone || (conv?.name?.includes("+") ? conv.name : undefined);

    const newMsg: Message = {
      id: createUuid(),
      conversationId,
      senderId: currentUser.id,
      senderName: currentUser.displayName,
      senderAvatar: currentUser.avatar,
      targetUserId,
      targetPhone,
      text,
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      status: navigator.onLine ? "sent" : "pending",
      ...extra,
    };

    soundFx.playSent();

    setMessages((prev) => {
      const currentList = prev[conversationId] ?? [];
      const updated = {
        ...prev,
        [conversationId]: [...currentList, newMsg],
      };
      storage.saveMessages(updated);
      return updated;
    });

    // Update conversation preview snippet & timestamp & clear any unread on active chat
    setConversations((prev) => {
      const updated = prev.map((conv) => {
        if (conv.id === conversationId) {
          return {
            ...conv,
            lastMessage: newMsg,
            unreadCount: 0,
          };
        }
        return conv;
      });
      moveConversationToRecent(updated, conversationId);
      storage.saveConversations(updated);
      return updated;
    });

    if (!navigator.onLine) {
      queueMessage(newMsg);
      return true;
    } else {
      return (await dispatchMessage(newMsg)) !== "failed";
    }
  }

  async function handleScheduleMessage(
    conversationId: string,
    text: string,
    scheduledFor: string,
    extra?: Pick<Message, "replyTo" | "linkPreviewDisabled">,
  ): Promise<Message> {
    if (!currentUser) throw new Error("Sign in before scheduling a message.");
    if (!navigator.onLine) throw new Error("Connect to the internet to schedule a message.");
    const scheduledDate = new Date(scheduledFor);
    if (Number.isNaN(scheduledDate.getTime()) || scheduledDate.getTime() <= Date.now()) {
      throw new Error("Choose a delivery time in the future.");
    }

    const conversation = conversations.find((item) => item.id === conversationId);
    const message: Message = {
      id: createUuid(),
      conversationId,
      senderId: currentUser.id,
      senderName: currentUser.displayName,
      senderAvatar: currentUser.avatar,
      text,
      timestamp: new Date().toISOString(),
      status: "scheduled",
      scheduledFor: scheduledDate.toISOString(),
      ...(extra?.replyTo ? { replyTo: extra.replyTo } : {}),
      ...(extra?.linkPreviewDisabled ? { linkPreviewDisabled: true } : {}),
      ...(conversation?.peerUserId ? { targetUserId: conversation.peerUserId } : {}),
    };

    const response = await fetch(
      `/api/conversations/${encodeURIComponent(conversationId)}/scheduled-messages`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: message.id,
          text: message.text,
          scheduledFor: message.scheduledFor,
          metadata: {
            senderId: currentUser.id,
            senderName: currentUser.displayName,
            senderAvatar: currentUser.avatar,
            ...(message.replyTo ? { replyTo: message.replyTo } : {}),
            ...(message.linkPreviewDisabled ? { linkPreviewDisabled: true } : {}),
          },
        }),
      },
    );
    const result = await response.json() as { message?: Partial<Message>; error?: { message?: string } };
    if (!response.ok || !result.message) {
      throw new Error(result.error?.message || "Could not schedule this message.");
    }
    const scheduledMessage: Message = { ...message, ...result.message, status: "scheduled" };

    setMessages((previous) => {
      const list = previous[conversationId] ?? [];
      const next = list.some((item) => item.id === scheduledMessage.id)
        ? list.map((item) => item.id === scheduledMessage.id ? scheduledMessage : item)
        : [...list, scheduledMessage];
      const updated = { ...previous, [conversationId]: next };
      storage.saveMessages(updated);
      return updated;
    });
    setConversations((previous) => {
      const updated = previous.map((item) =>
        item.id === conversationId ? { ...item, lastMessage: scheduledMessage } : item
      );
      moveConversationToRecent(updated, conversationId);
      conversationsRef.current = updated;
      storage.saveConversations(updated);
      return updated;
    });
    setChatSyncError(null);
    return scheduledMessage;
  }

  // Add a new conversation
  async function handleAddConversation(newConv: Conversation): Promise<Conversation | void> {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch("/api/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          name: newConv.name,
          type: newConv.type,
          avatar: newConv.avatar,
          description: newConv.description,
          ...(newConv.peerUserId ? { peerUserId: newConv.peerUserId } : {}),
          ...(newConv.members ? { memberIds: newConv.members.map((member) => member.id) } : {}),
        }),
      });
      const result = await response.json() as { conversation?: Conversation; error?: { message?: string } };
      if (!response.ok || !result.conversation) {
        throw new Error(result.error?.message || "Could not create conversation.");
      }
      const createdConversation = applyPresenceToConversation({
        ...newConv,
        ...result.conversation,
        unreadCount: 0,
      });
      setConversations((previous) => {
        const existingPeerConversation = createdConversation.type === "direct" && createdConversation.peerUserId
          ? previous.find((conversation) =>
              conversation.type === "direct" &&
              conversation.peerUserId === createdConversation.peerUserId
            )
          : undefined;
        if (existingPeerConversation) {
          const updated = previous.map((conversation) =>
            conversation.id === existingPeerConversation.id
              ? { ...conversation, ...createdConversation, id: existingPeerConversation.id }
              : conversation
          ).filter((conversation) =>
            conversation.id === existingPeerConversation.id ||
            !(conversation.type === "direct" &&
              conversation.peerUserId === createdConversation.peerUserId)
          );
          storage.saveConversations(updated);
          setActiveConversationId(existingPeerConversation.id);
          return updated;
        }
        if (previous.some((conversation) => conversation.id === createdConversation.id)) return previous;
        const updated = deduplicateConversations([createdConversation, ...previous]);
        storage.saveConversations(updated);
        return updated;
      });
      setActiveConversationId(createdConversation.id);
      setChatSyncError(null);
      return createdConversation;
    } catch (error) {
      const message = error instanceof DOMException && error.name === "AbortError"
        ? "Creating the group timed out. Check that the API and PostgreSQL are running, then try again."
        : error instanceof Error ? error.message : "Could not create conversation.";
      setChatSyncError(message);
      throw new Error(message);
    } finally {
      window.clearTimeout(timeout);
    }
  }

  async function handleQrConnect(username: string): Promise<void> {
    if (!currentUser) throw new Error("Sign in to connect with this profile.");
    const normalizedUsername = username.trim().replace(/^@/, "").toLowerCase();
    if (!/^[a-z0-9_]{3,30}$/.test(normalizedUsername)) {
      throw new Error("This QR code does not contain a valid ConnectSphere username.");
    }
    if (normalizedUsername === currentUser.username.toLowerCase()) {
      throw new Error("This is your own profile QR code.");
    }

    const response = await fetch(`/api/auth/lookup?query=${encodeURIComponent(normalizedUsername)}`);
    const result = await response.json() as {
      user?: User;
      message?: string;
      error?: { message?: string };
    };
    if (!response.ok || !result.user) {
      throw new Error(result.message || result.error?.message || "Could not find this ConnectSphere profile.");
    }

    const peer = result.user;
    const conversation = await handleAddConversation({
      id: "",
      type: "direct",
      name: peer.displayName || peer.username,
      avatar: peer.avatar || "/avatars/boy.png",
      peerUserId: peer.id,
      ...(peer.email ? { peerEmail: peer.email } : {}),
      ...(peer.phone ? { peerPhone: peer.phone } : {}),
      unreadCount: 0,
      description: peer.bio || "ConnectSphere Member",
    });
    if (conversation === undefined) throw new Error("Could not open a chat with this profile.");

    setActiveTab("chats");
    setIsQrModalOpen(false);
  }

  useEffect(() => {
    if (isCheckingSession || !currentUser) return;

    const url = new URL(window.location.href);
    const username = url.searchParams.get("connect");
    if (!username) return;

    const normalizedUsername = username.trim().replace(/^@/, "").toLowerCase();
    if (processedConnectUsernameRef.current === normalizedUsername) return;
    processedConnectUsernameRef.current = normalizedUsername;

    url.searchParams.delete("connect");
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);

    void handleQrConnect(username).catch((error: unknown) => {
      setActiveTab("chats");
      setChatSyncError(error instanceof Error ? error.message : "Could not connect to this profile.");
    });
  }, [currentUser?.id, currentUser?.username, isCheckingSession]);

  function clearCallEndedScreen() {
    if (callEndedTimerRef.current !== null) {
      window.clearTimeout(callEndedTimerRef.current);
      callEndedTimerRef.current = null;
    }
    setIsCallEnded(false);
  }

  function handleCallFinished(showEndedScreen = true) {
    if (callEndedTimerRef.current !== null) {
      window.clearTimeout(callEndedTimerRef.current);
      callEndedTimerRef.current = null;
    }
    setIsCallModalOpen(false);
    setActiveCallId(null);
    setCallAccepted(false);
    setIsCallInitiator(false);
    setCallParticipants([]);
    setIsCallEnded(showEndedScreen);
    if (showEndedScreen) {
      callEndedTimerRef.current = window.setTimeout(() => {
        callEndedTimerRef.current = null;
        setIsCallEnded(false);
      }, 1800);
    }
  }

  // Start Call Handler
  async function handleStartCall(
    peerName: string,
    peerAvatar: string,
    isVideo: boolean,
    targetUserId?: string,
    targetPhone?: string
  ) {
    if (!targetUserId && !targetPhone) {
      alert("This conversation has no registered call recipient. Reopen the contact from Contacts and try again.");
      return;
    }
    const isConnected = conversationsRef.current.some((conversation) =>
      conversation.type === "direct" &&
      ((targetUserId && conversation.peerUserId === targetUserId) ||
        (targetPhone && conversation.peerPhone === targetPhone))
    );
    if (!isConnected) {
      alert("You can call this person after they accept your connection request.");
      return;
    }

    try {
      await realtime.waitUntilConnected();
    } catch (error) {
      alert(error instanceof Error ? error.message : "Could not connect to the call server.");
      return;
    }

    const callId = createUuid();
    setActiveCallId(callId);
    setIsCallInitiator(true);
    setCallAccepted(false);
    setCallPeer({ name: peerName, avatar: peerAvatar, isVideo });
    setCallParticipants(targetUserId ? [{ id: targetUserId, displayName: peerName, avatar: peerAvatar }] : []);
    clearCallEndedScreen();
    setIsCallModalOpen(true);

    if (!realtime.sendCallInvite(callId, peerName, isVideo, peerAvatar, targetUserId, targetPhone)) {
      handleCallFinished(false);
      alert("The call could not be sent because the realtime connection closed. Please try again.");
      return;
    }

    const record: CallRecord = {
      id: callId,
      peerId: targetUserId || "peer-dialed",
      peerName,
      peerAvatar,
      type: isVideo ? "video" : "voice",
      direction: "outgoing",
      timestamp: new Date().toISOString(),
      durationSec: 0,
    };
    setCallHistory((prev) => {
      const updated = [record, ...prev];
      storage.saveCalls(updated);
      return updated;
    });
  }

  // Handle Incoming Call Acceptance
  async function handleAcceptIncomingCall() {
    if (!incomingCall) return;
    try {
      await realtime.waitUntilConnected();
    } catch (error) {
      alert(error instanceof Error ? error.message : "Could not connect to the call server.");
      return;
    }
    if (!realtime.sendCallAccept(incomingCall.callId)) {
      alert("The call could not be accepted because the realtime connection closed. Please try again.");
      return;
    }
    setActiveCallId(incomingCall.callId);
    setIsCallInitiator(false);
    setCallAccepted(true);
    setCallPeer({
      name: incomingCall.peerName,
      avatar: incomingCall.peerAvatar,
      isVideo: incomingCall.isVideo,
    });
    setCallParticipants(incomingCall.peerUserId
      ? [{
          id: incomingCall.peerUserId,
          displayName: incomingCall.peerName,
          avatar: incomingCall.peerAvatar,
        }]
      : []);
    clearCallEndedScreen();
    setIsCallModalOpen(true);

    const record: CallRecord = {
      id: incomingCall.callId,
      peerId: incomingCall.peerUserId ?? "peer-incoming",
      peerName: incomingCall.peerName,
      peerAvatar: incomingCall.peerAvatar,
      type: incomingCall.isVideo ? "video" : "voice",
      direction: "incoming",
      timestamp: new Date().toISOString(),
      durationSec: 0,
    };
    setCallHistory((prev) => {
      const updated = [record, ...prev];
      storage.saveCalls(updated);
      return updated;
    });

    setIncomingCall(null);
  }

  // Handle Incoming Call Rejection / Decline
  function handleDeclineIncomingCall() {
    if (!incomingCall) return;
    realtime.sendCallDecline(incomingCall.callId);
    soundFx.playCallEnd();

    const record: CallRecord = {
      id: incomingCall.callId,
      peerId: incomingCall.peerUserId ?? "peer-incoming",
      peerName: incomingCall.peerName,
      peerAvatar: incomingCall.peerAvatar,
      type: incomingCall.isVideo ? "video" : "voice",
      direction: "missed",
      timestamp: new Date().toISOString(),
      durationSec: 0,
    };
    setCallHistory((prev) => {
      const updated = [record, ...prev];
      storage.saveCalls(updated);
      return updated;
    });

    setIncomingCall(null);
  }

  if (isCheckingSession) {
    return (
      <main className="session-loading" role="status" aria-label="Checking your session">
        <div className="session-loading-content">
          <div className="session-loading-brand">
            <span>Connect</span>Sphere
          </div>
          <div className="session-loading-dots" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <p>Checking your session</p>
        </div>
      </main>
    );
  }

  if (sessionCheckError) {
    return (
      <main className="session-loading session-loading-error" role="alert">
        <p>{sessionCheckError}</p>
        <button type="button" onClick={() => window.location.reload()}>Try again</button>
      </main>
    );
  }

  // If user is not signed in, show WhatsApp authentication flow
  if (!currentUser) {
    return (
      <WhatsAppAuth
        isOpen={true}
        onSignedIn={(user) => {
          setCurrentUser(user);
          storage.saveUser(user);
        }}
      />
    );
  }

  // Calculate unread count and missed calls count
  const totalUnreadCount = Object.values(messages).reduce((acc, list) => {
    return acc + list.filter((m) => m.senderId !== currentUser.id && m.status !== "read").length;
  }, 0);

  const missedCallsCount = callHistory.filter((c) => c.direction === "missed").length;

  return (
    <div className={`app-shell ${activeTab === "chats" ? "is-chats-tab" : ""}`}>
      {/* 1. Left Vertical App Rail */}
      <AppRail
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        currentUser={currentUser}
        unreadCount={totalUnreadCount}
        missedCallsCount={missedCallsCount}
        isOnline={isOnline}
        onLockApp={() => {
          if (appPin) {
            setUnlockedChatIds(new Set());
            setIsAppLocked(true);
            storage.saveIsAppLocked(true);
          } else {
            setSettingsInitialSection("security");
            setActiveTab("settings");
          }
        }}
        onOpenProfile={() => setActiveTab("settings")}
      />

      {/* 2. Main Viewport */}
      <div className="app-main-viewport">
        {/* Top Header - Displayed for calls, contacts, workspace, and settings. On chats, the 3-section messaging architecture provides dedicated sidebar and conversation headers. */}
        {activeTab !== "chats" && (
          <Header
            activeTab={activeTab}
            isOnline={isOnline}
            onStartInstantCall={() => {
              const active = conversations.find((c) => c.id === activeConversationId);
              if (active) {
                handleStartCall(active.name, active.avatar, true, active.peerUserId, active.peerPhone);
              } else {
                setActiveTab("calls");
              }
            }}
            onOpenQrModal={() => setIsQrModalOpen(true)}
          />
        )}

        {/* Content Body Based on Active Tab */}
        <div className="app-content-body">
          {chatSyncError && activeTab === "chats" && (
            <div role="alert" aria-live="assertive" className="chat-sync-error-toast">
              <span>
                {chatSyncError === "Request payload exceeds size limit."
                  ? "Message or attachment is too large to send. Try a smaller file."
                  : chatSyncError}
              </span>
              <button type="button" onClick={() => setChatSyncError(null)} aria-label="Dismiss message">
                Dismiss
              </button>
            </div>
          )}
          {activeTab === "chats" && (
            <ChatsView
              key={currentUser.id}
              conversations={conversations}
              messages={messages}
              activeConversationId={activeConversationId}
              onSelectConversation={setActiveConversationId}
              onSendMessage={handleSendMessage}
              onScheduleMessage={handleScheduleMessage}
              onRetryMessage={(message) => void dispatchMessage({ ...message, status: "pending" })}
              onStartCall={handleStartCall}
              onUnlockLockedChat={(convId) => {
                setUnlockedChatIds(new Set());
                if (appPin) {
                  setPendingUnlockChatId(convId);
                } else {
                  setSettingsInitialSection("security");
                  setActiveTab("settings");
                }
              }}
              onSetConversationLock={async (conversationId, isLocked) => {
                const response = await fetch(
                  `/api/conversations/${encodeURIComponent(conversationId)}/lock`,
                  {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ isLocked }),
                  },
                );
                const result = await response.json() as {
                  isLocked?: boolean;
                  error?: { message?: string };
                };
                if (!response.ok || result.isLocked !== isLocked) {
                  throw new Error(result.error?.message || "Could not update conversation lock.");
                }
                setConversations((previous) => {
                  const updated = previous.map((conversation) =>
                    conversation.id === conversationId
                      ? { ...conversation, isLocked: result.isLocked }
                      : conversation
                  );
                  conversationsRef.current = updated;
                  storage.saveConversations(updated);
                  return updated;
                });
                if (isLocked) {
                  setUnlockedChatIds((previous) => {
                    const updated = new Set(previous);
                    updated.delete(conversationId);
                    return updated;
                  });
                }
              }}
              onSetDisappearingTimer={async (conversationId, hours) => {
                const response = await fetch(
                  `/api/conversations/${encodeURIComponent(conversationId)}/disappearing-timer`,
                  {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ hours }),
                  },
                );
                const result = await response.json() as {
                  disappearingTimerHours?: number;
                  error?: { message?: string };
                };
                if (!response.ok || result.disappearingTimerHours !== hours) {
                  throw new Error(result.error?.message || "Could not update the disappearing-message timer.");
                }
                setConversations((previous) => {
                  const updated = previous.map((conversation) =>
                    conversation.id === conversationId
                      ? { ...conversation, disappearingTimerHours: hours }
                      : conversation
                  );
                  conversationsRef.current = updated;
                  storage.saveConversations(updated);
                  return updated;
                });
                realtime.send("chat:disappearing", { conversationId, hours }, conversationId);
              }}
              hasAppPin={Boolean(appPin)}
              onRequestAppPin={() => {
                setSettingsInitialSection("security");
                setActiveTab("settings");
              }}
              currentUser={currentUser}
              isOnline={isOnline}
              unlockedChatIds={unlockedChatIds}
              onVisibleConversationChange={handleVisibleConversationChange}
              onAddConversation={handleAddConversation}
              onOpenContacts={() => setActiveTab("contacts")}
              onUpdateMessages={(updater) => {
                setMessages((prev) => {
                  const next = updater(prev);
                  storage.saveMessages(next);
                  return next;
                });
              }}
              onUpdateConversations={(updater) => {
                setConversations((prev) => {
                  const next = updater(prev);
                  storage.saveConversations(next);
                  return next;
                });
              }}
            />
          )}

          {activeTab === "calls" && (
            <CallsView
              callHistory={callHistory}
              onStartCall={handleStartCall}
              onDeleteCallRecord={(recordId) => {
                setCallHistory((previous) => {
                  const updated = previous.filter((record) => record.id !== recordId);
                  storage.saveCalls(updated);
                  return updated;
                });
              }}
              onClearCallHistory={() => {
                setCallHistory([]);
                storage.saveCalls([]);
              }}
              currentUser={currentUser}
              conversations={conversations}
            />
          )}

          {activeTab === "contacts" && (
            <ContactsView
              conversations={conversations}
              onStartChat={(convId) => {
                setActiveConversationId(convId);
                setActiveTab("chats");
              }}
              onStartCall={handleStartCall}
              currentUser={currentUser}
              onAddConversation={handleAddConversation}
            />
          )}

          {activeTab === "workspace" && (
            <WorkspaceView
              doc={doc}
              onUpdateDoc={(updatedDoc) => {
                setDoc(updatedDoc);
                storage.saveDoc(updatedDoc);
              }}
            />
          )}

          {activeTab === "settings" && (
            <SettingsView
              initialSection={settingsInitialSection}
              currentUser={currentUser}
              onUpdateUser={async (updated) => {
                const response = await fetch("/api/auth/profile", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    displayName: updated.displayName,
                    username: updated.username,
                    avatar: updated.avatar,
                    bio: updated.bio,
                    statusText: updated.statusText,
                    profilePhotoProtection: updated.profilePhotoProtection,
                  }),
                });
                const result = await response.json() as { user?: User; error?: { message?: string } };
                if (!response.ok || !result.user) {
                  throw new Error(result.error?.message || "Could not save your profile.");
                }
                setCurrentUser(result.user);
                storage.saveUser(result.user);
              }}
              onLockApp={() => {
                if (appPin) {
                  setUnlockedChatIds(new Set());
                  setIsAppLocked(true);
                  storage.saveIsAppLocked(true);
                }
              }}
              hasLockedConversations={conversations.some((conversation) => conversation.isLocked)}
              appPin={appPin}
              onUpdatePin={(p) => {
                setAppPin(p);
                storage.saveAppPin(p);
                setUnlockedChatIds(new Set());
                if (!p) {
                  setIsAppLocked(false);
                  storage.saveIsAppLocked(false);
                }
              }}
              accessibility={accessibility}
              onUpdateAccessibility={(acc) => {
                setAccessibility(acc);
                storage.saveAccessibility(acc);
                soundFx.setEnabled(acc.soundFeedback);
                if (acc.soundFeedback) soundFx.unlockAudio();
              }}
              onUpdateReadReceipts={async (enabled) => {
                const response = await fetch("/api/auth/privacy-settings", {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ readReceiptsEnabled: enabled }),
                });
                const result = await response.json() as { user?: User; error?: { message?: string } };
                if (!response.ok || !result.user) {
                  throw new Error(result.error?.message || "Could not update read receipt settings.");
                }
                setCurrentUser(result.user);
                storage.saveUser(result.user);
              }}
              onSignOut={async () => {
                const response = await fetch("/api/auth/logout", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: "{}",
                });
                if (!response.ok) {
                  const result = await response.json().catch(() => null) as { error?: { message?: string } } | null;
                  throw new Error(result?.error?.message || "Could not sign out. Please try again.");
                }
                realtime.disconnect();
                storage.saveUser(null);
                storage.saveIsAppLocked(false);
                setIsAppLocked(false);
                setUnlockedChatIds(new Set());
                setPendingUnlockChatId(null);
                setCurrentUser(null);
              }}
            />
          )}
        </div>
      </div>

      {/* 2.5 Real-Time Incoming Call Modal Ringing Prompt */}
      <IncomingCallModal
        isOpen={incomingCall !== null}
        callerName={incomingCall?.peerName ?? "Caller"}
        callerAvatar={incomingCall?.peerAvatar ?? "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=400&q=80"}
        isVideo={incomingCall?.isVideo ?? true}
        onAccept={handleAcceptIncomingCall}
        onDecline={handleDeclineIncomingCall}
      />

      {/* 3. Active Call Fullscreen Overlay */}
      <CallModal
        isOpen={isCallModalOpen}
        isEnded={isCallEnded}
        callId={activeCallId}
        currentUserId={currentUser?.id ?? ""}
        isInitiator={isCallInitiator}
        isAccepted={callAccepted}
        onHangup={handleCallFinished}
        peerName={callPeer.name}
        peerAvatar={callPeer.avatar}
        isVideo={callPeer.isVideo}
        participants={callParticipants}
        availableContacts={conversations.filter(
          (conversation) => conversation.type === "direct" &&
            (conversation.peerUserId || conversation.peerPhone),
        )}
      />

      {/* 4. QR Profile & Scanner Modal */}
      <QrModal
        isOpen={isQrModalOpen}
        onClose={() => setIsQrModalOpen(false)}
        currentUser={currentUser}
        onScannedUser={handleQrConnect}
      />

      {/* 5. App PIN Lock Screen (when locked manually) */}
      <AppLockModal
        isOpen={isAppLocked}
        onUnlock={() => {
          setIsAppLocked(false);
          storage.saveIsAppLocked(false);
        }}
        expectedPin={appPin ?? ""}
        title="ConnectSphere Locked"
        subtitle="Enter 4-digit PIN to restore session"
      />

      {/* 6. Locked Chat PIN Modal (when opening confidential chat) */}
      <AppLockModal
        isOpen={pendingUnlockChatId !== null}
        onClose={() => setPendingUnlockChatId(null)}
        onUnlock={() => {
          if (pendingUnlockChatId) {
            setUnlockedChatIds(new Set([pendingUnlockChatId]));
            setActiveConversationId(pendingUnlockChatId);
            setPendingUnlockChatId(null);
          }
        }}
        expectedPin={appPin ?? ""}
        title="Unlock Private Chat"
        subtitle="Enter your PIN to access this protected conversation."
      />

      <PwaInstallPrompt />
    </div>
  );
}
