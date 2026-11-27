import { Fragment, useState, useRef, useEffect, useLayoutEffect, useCallback } from "react";
import type { ChangeEvent, FormEvent, ReactNode } from "react";
import {
  Search,
  Phone,
  Video,
  Send,
  Paperclip,
  Smile,
  Mic,
  Clock,
  Check,
  CheckCheck,
  Pin,
  Star,
  MoreVertical,
  Volume2,
  Trash2,
  CornerUpLeft,
  X,
  Lock,
  Plus,
  Users,
  User as UserIcon,
  Mail,
  Image as ImageIcon,
  FileText,
  Calendar,
  Sparkles,
  ArrowLeft,
  AlertCircle,
  ShieldCheck,
  ArrowRight,
  RefreshCw,
  Hash,
  MessageSquare,
  ChevronUp,
  ChevronDown,
  Copy,
  Pencil,
  Forward,
  BarChart2,
  Download,
  Info,
  Sliders,
  Shield,
  ShieldAlert,
  Ghost,
  Globe,
  Eye,
  Maximize2,
  Share2,
  Upload,
} from "lucide-react";
import type {
  Conversation,
  Message,
  MessageReadReceipt,
  SharedContact,
  User,
  PollData,
  PollOption,
} from "../services/types.js";
import { AudioPlayer } from "../components/AudioPlayer.js";
import { soundFx } from "../services/soundFx.js";
import { realtime } from "../services/realtime.js";
import { getSafeAvatar } from "../services/avatars.js";
import { updateMessageReaction } from "../services/reactions.js";
import { InviteLinkManualCopy } from "../components/InviteLinkManualCopy.js";
import { createInviteLink, shareInviteUrl } from "../services/inviteLinks.js";
import { createUuid } from "../services/ids.js";
import {
  CHAT_WALLPAPERS,
  CUSTOM_CHAT_WALLPAPER_ID,
  DEFAULT_CHAT_WALLPAPER,
  type ChatWallpaperSelection,
} from "../services/chatWallpapers.js";
import { storage } from "../services/storage.js";
import { formatLastSeen } from "../services/time.js";
import { canForwardMessage } from "../services/forwarding.js";

const MAX_CUSTOM_WALLPAPER_BYTES = 10 * 1024 * 1024;
const CUSTOM_WALLPAPER_MIME_TYPES = new Set([
  "image/avif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

type ChatsViewProps = {
  conversations: Conversation[];
  messages: Record<string, Message[]>;
  activeConversationId: string;
  onSelectConversation: (id: string) => void;
  onSendMessage: (conversationId: string, text: string, extra?: Partial<Message>) => void | Promise<boolean>;
  onScheduleMessage: (
    conversationId: string,
    text: string,
    scheduledFor: string,
    extra?: Pick<Message, "replyTo" | "linkPreviewDisabled">,
  ) => Promise<Message>;
  onRetryMessage?: (message: Message) => void;
  onStartCall: (peerName: string, peerAvatar: string, isVideo: boolean, targetUserId?: string, targetPhone?: string) => void;
  onUnlockLockedChat: (conversationId: string) => void;
  onSetConversationLock: (conversationId: string, isLocked: boolean) => Promise<void>;
  onSetDisappearingTimer: (conversationId: string, hours: number) => Promise<void>;
  hasAppPin: boolean;
  onRequestAppPin: () => void;
  currentUser: User;
  isOnline: boolean;
  unlockedChatIds: Set<string>;
  onVisibleConversationChange?: (conversationId: string | null) => void;
  onAddConversation?: (conv: Conversation) => Promise<Conversation | void>;
  onOpenContacts?: () => void;
  onUpdateMessages?: (updater: (prev: Record<string, Message[]>) => Record<string, Message[]>) => void;
  onUpdateConversations?: (updater: (prev: Conversation[]) => Conversation[]) => void;
};

type PollOptionDraft = {
  id: string;
  text: string;
};

type DeviceContact = {
  name?: string[];
  tel?: string[];
  email?: string[];
};

type ContactPickerNavigator = Navigator & {
  contacts?: {
    select(
      properties: Array<"name" | "tel" | "email">,
      options?: { multiple?: boolean },
    ): Promise<DeviceContact[]>;
  };
};

function createPollOptionDraft(): PollOptionDraft {
  return { id: createUuid(), text: "" };
}

type LinkPreview = {
  url: string;
  hostname: string;
  title?: string;
  description?: string;
  thumbnail?: string;
};

const resolvedLinkPreviews = new Map<string, { expiresAt: number; preview: LinkPreview }>();
const pendingLinkPreviews = new Map<string, Promise<LinkPreview>>();

function getLinkPreview(text: string): LinkPreview | null {
  const match = text.match(/https?:\/\/[^\s<>"']+/i);
  if (!match) return null;

  const candidate = match[0].replace(/[),.!?;:]+$/g, "");
  try {
    const url = new URL(candidate);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || !url.hostname.includes(".")) {
      return null;
    }
    return { url: url.href, hostname: url.hostname };
  } catch {
    return null;
  }
}

function getLinkPreviews(text: string): LinkPreview[] {
  const previews: LinkPreview[] = [];
  const seen = new Set<string>();
  const urlPattern = /https?:\/\/[^\s<>"']+/gi;
  for (const match of text.matchAll(urlPattern)) {
    const candidate = match[0].replace(/[),.!?;:]+$/g, "");
    const preview = getLinkPreview(candidate);
    if (preview && !seen.has(preview.url)) {
      seen.add(preview.url);
      previews.push(preview);
    }
  }
  return previews;
}

function fetchLinkPreview(url: string): Promise<LinkPreview> {
  const cached = resolvedLinkPreviews.get(url);
  if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.preview);
  if (cached) resolvedLinkPreviews.delete(url);

  const pending = pendingLinkPreviews.get(url);
  if (pending) return pending;

  const request = fetch(`/api/link-previews?url=${encodeURIComponent(url)}`)
    .then(async (response) => {
      if (!response.ok) throw new Error("Could not load preview metadata.");
      const body = await response.json() as { preview?: LinkPreview };
      if (
        !body.preview ||
        typeof body.preview.title !== "string" ||
        typeof body.preview.description !== "string"
      ) {
        throw new Error("Preview metadata was invalid.");
      }
      if (resolvedLinkPreviews.size >= 100) {
        const oldestUrl = resolvedLinkPreviews.keys().next().value;
        if (oldestUrl) resolvedLinkPreviews.delete(oldestUrl);
      }
      resolvedLinkPreviews.set(url, {
        expiresAt: Date.now() + 10 * 60 * 1000,
        preview: body.preview,
      });
      return body.preview;
    })
    .finally(() => pendingLinkPreviews.delete(url));
  pendingLinkPreviews.set(url, request);
  return request;
}

function renderMessageLinks(text: string): ReactNode {
  const urlPattern = /https?:\/\/[^\s<>"']+/gi;
  const nodes: ReactNode[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(urlPattern)) {
    const rawUrl = match[0];
    const urlIndex = match.index ?? 0;
    const linkText = rawUrl.replace(/[),.!?;:]+$/g, "");
    const preview = getLinkPreview(linkText);
    if (!preview) continue;

    if (urlIndex > lastIndex) nodes.push(text.slice(lastIndex, urlIndex));
    nodes.push(
      <a
        key={`${urlIndex}-${preview.url}`}
        className="message-link"
        href={preview.url}
        target="_blank"
        rel="noopener noreferrer"
      >
        {linkText}
      </a>,
    );
    const trailingPunctuation = rawUrl.slice(linkText.length);
    if (trailingPunctuation) nodes.push(trailingPunctuation);
    lastIndex = urlIndex + rawUrl.length;
  }

  if (lastIndex === 0) return text;
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

function LinkPreviewCard({
  preview,
  className,
  onDismiss,
}: {
  preview: LinkPreview;
  className: string;
  onDismiss?: () => void;
}) {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [metadata, setMetadata] = useState<LinkPreview | null>(null);
  const [previewUnavailable, setPreviewUnavailable] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);

  useEffect(() => {
    let active = true;
    let timer: number | undefined;
    setMetadata(null);
    setPreviewUnavailable(false);
    const loadPreview = () => {
      setPreviewLoading(true);
      timer = window.setTimeout(() => {
        void fetchLinkPreview(preview.url)
          .then(
            (result) => {
              if (active) setMetadata(result);
            },
            () => {
              if (active) setPreviewUnavailable(true);
            },
          )
          .finally(() => {
            if (active) setPreviewLoading(false);
          });
      }, 500);
    };

    const element = cardRef.current;
    if (element && "IntersectionObserver" in window) {
      const observer = new IntersectionObserver(
        (entries) => {
          if (entries.some((entry) => entry.isIntersecting)) {
            observer.disconnect();
            loadPreview();
          }
        },
        { rootMargin: "200px" },
      );
      observer.observe(element);
      return () => {
        active = false;
        observer.disconnect();
        if (timer !== undefined) window.clearTimeout(timer);
      };
    }

    loadPreview();
    return () => {
      active = false;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [preview.url]);

  const thumbnail =
    metadata?.thumbnail && /^data:image\/(?:jpeg|png|webp|gif);base64,/i.test(metadata.thumbnail)
      ? metadata.thumbnail
      : undefined;

  return (
    <div ref={cardRef} className={`link-preview-card ${className}`}>
      {thumbnail && <img className="link-preview-thumbnail" src={thumbnail} alt="" loading="lazy" />}
      <div className="link-preview-copy">
        <strong className="link-preview-title">{metadata?.title || preview.hostname}</strong>
        {metadata?.description && <span className="link-preview-description">{metadata.description}</span>}
        <a
          className="link-preview-url"
          href={preview.url}
          target="_blank"
          rel="noopener noreferrer"
        >
          {preview.url}
        </a>
        <span className="link-preview-host">{preview.hostname}</span>
        {previewLoading && <span className="link-preview-status">Loading preview…</span>}
        {previewUnavailable && <span className="link-preview-status">Preview details unavailable</span>}
      </div>
      {onDismiss && (
        <button
          type="button"
          className="link-preview-dismiss"
          onClick={onDismiss}
          aria-label="Dismiss link previews"
          title="Dismiss previews for this message"
        >
          <X size={17} />
        </button>
      )}
    </div>
  );
}

// WhatsApp Emoji Library for Picker
const EMOJI_CATEGORIES: Record<string, { label: string; icon: string; items: string[] }> = {
  smileys: {
    label: "Smileys",
    icon: "😀",
    items: [
      "😀", "😃", "😄", "😁", "😆", "😅", "😂", "🤣", "🥲", "☺️",
      "😊", "😇", "🙂", "🙃", "😉", "😌", "😍", "🥰", "😘", "😗",
      "😙", "😚", "😋", "😛", "😝", "😜", "🤪", "🤨", "🧐", "🤓",
      "😎", "🥸", "🤩", "🥳", "😏", "😒", "😞", "😔", "😟", "😕",
      "🙁", "☹️", "😣", "😖", "😫", "😩", "🥺", "😢", "😭", "😤",
      "😠", "😡", "🤬", "🤯", "😳", "🥵", "🥶", "😱", "😨", "😰",
      "😥", "😓", "🤗", "🤔", "🤭", "🤫", "🤥", "😶", "😐", "😑",
    ],
  },
  people: {
    label: "Gestures",
    icon: "👍",
    items: [
      "👋", "🤚", "🖐️", "✋", "🖖", "👌", "🤌", "🤏", "✌️", "🤞",
      "🫰", "🤟", "🤘", "🤙", "👈", "👉", "👆", "👇", "☝️", "👍",
      "👎", "✊", "👊", "🤛", "🤜", "👏", "🙌", "👐", "🤲", "🤝",
      "🙏", "✍️", "💅", "🤳", "💪", "🦾", "🦿", "🦵", "🦶", "👂",
    ],
  },
  hearts: {
    label: "Hearts",
    icon: "❤️",
    items: [
      "❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍", "🤎", "💔",
      "❤️‍🔥", "❤️‍🩹", "❣️", "💕", "💞", "💓", "💗", "💖", "💘", "💝",
      "💟", "☮️", "✝️", "☪️", "🕉️", "☸️", "✡️", "🔯", "🕎", "☯️",
    ],
  },
  food: {
    label: "Food",
    icon: "🍔",
    items: [
      "🍏", "🍎", "🍐", "🍊", "🍋", "🍌", "🍉", "🍇", "🍓", "🫐",
      "🍒", "🍑", "🥭", "🍍", "🥥", "🥝", "🍅", "🥑", "🥦", "🌶️",
      "🥐", "🍞", "🥖", "🥨", "🧀", "🍳", "🥞", "🧇", "🥓", "🥩",
      "🍔", "🍟", "🍕", "🌭", "🥪", "🌮", "🌯", "🥗", "🍝", "🍜",
      "🍣", "🍦", "🎂", "🍰", "🍩", "🍪", "🍫", "🍿", "☕", "🧃",
    ],
  },
  objects: {
    label: "Objects",
    icon: "💡",
    items: [
      "📱", "💻", "🖥️", "⌨️", "🖱️", "🖲️", "💾", "💿", "📷", "📸",
      "📹", "🔍", "🔎", "🕯️", "💡", "🔦", "📚", "📓", "📝", "💼",
      "📁", "📂", "📅", "📊", "📋", "📌", "📎", "🔒", "🔓", "🔑",
      "🔥", "✨", "🎉", "🎊", "🏆", "🥇", "🥈", "🥉", "⚽", "🏀",
    ],
  },
};

function parseMessageDate(timestamp: string): Date | null {
  const parsed = new Date(timestamp);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatMessageTime(timestamp: string): string {
  const date = parseMessageDate(timestamp);
  return date
    ? new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date)
    : timestamp;
}

function formatMessageDateLabel(date: Date): string {
  const today = new Date();
  const dateDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const todayDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const daysAgo = Math.round((todayDay.getTime() - dateDay.getTime()) / 86_400_000);

  if (daysAgo === 0) return "Today";
  if (daysAgo === 1) return "Yesterday";
  if (daysAgo > 1 && daysAgo < 7) {
    return new Intl.DateTimeFormat(undefined, { weekday: "long" }).format(date);
  }
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "long",
    year: date.getFullYear() === today.getFullYear() ? undefined : "numeric",
  }).format(date);
}

function formatConversationTime(timestamp?: string): string {
  if (!timestamp) return "Recent";
  const date = parseMessageDate(timestamp);
  if (!date) return timestamp;

  const now = new Date();
  const dateDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const todayDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const daysAgo = Math.round((todayDay.getTime() - dateDay.getTime()) / 86_400_000);
  if (daysAgo === 0) return formatMessageTime(timestamp);
  if (daysAgo === 1) return "Yesterday";
  if (daysAgo > 1 && daysAgo < 7) {
    return new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(date);
  }
  return new Intl.DateTimeFormat(undefined, { month: "numeric", day: "numeric" }).format(date);
}

function isEmojiOnlyMessage(text: string): boolean {
  const content = text.trim();
  return content.length > 0 &&
    /^(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|\p{Emoji_Modifier}|\uFE0F|\u200D|\u20E3|\s)+$/u.test(content);
}

function getConversationSnippet(msg?: Message, defaultDesc?: string): string {
  if (!msg) return defaultDesc ?? "No messages yet";
  if (msg.isDeleted) return "This message was deleted";
  if (msg.status === "scheduled") return `Scheduled · ${msg.text}`;
  if (msg.voiceNote) return "🎤 Voice note";
  if (msg.poll) return `📊 Poll: ${msg.poll.question}`;
  if (msg.sharedContact) return `👤 Contact: ${msg.sharedContact.name}`;
  if (msg.attachments && msg.attachments.length > 0) {
    const first = msg.attachments[0];
    if (first && first.type === "image") return msg.text ? `📷 ${msg.text}` : `📷 Photo`;
    if (first && first.type === "video") return msg.text ? `🎥 ${msg.text}` : `🎥 Video`;
    return `📄 ${first?.name ?? "Attachment"}`;
  }
  return msg.text || defaultDesc || "No messages yet";
}

function getContactMailtoHref(email: string): string | null {
  const [localPart, domain, ...extra] = email.split("@");
  if (!localPart || !domain || extra.length > 0 || /[\r\n]/.test(email)) return null;
  return `mailto:${encodeURIComponent(localPart)}@${encodeURIComponent(domain)}`;
}

function formatDateTimeLocal(date: Date): string {
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return localDate.toISOString().slice(0, 16);
}

function formatScheduledDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Invalid date"
    : new Intl.DateTimeFormat(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }).format(date);
}

export function ChatsView({
  conversations,
  messages,
  activeConversationId,
  onSelectConversation,
  onSendMessage,
  onScheduleMessage,
  onRetryMessage,
  onStartCall,
  onUnlockLockedChat,
  onSetConversationLock,
  onSetDisappearingTimer,
  hasAppPin,
  onRequestAppPin,
  currentUser,
  isOnline,
  unlockedChatIds,
  onVisibleConversationChange,
  onAddConversation,
  onOpenContacts,
  onUpdateMessages,
  onUpdateConversations,
}: ChatsViewProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [lastSeenClock, setLastSeenClock] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setLastSeenClock(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const [filterType, setFilterType] = useState<"all" | "direct" | "group" | "unread" | "pinned">("all");
  const [showNewChatModal, setShowNewChatModal] = useState(false);
  const [newChatName, setNewChatName] = useState("");
  const [newChatType, setNewChatType] = useState<"direct" | "group">("direct");
  const [isCreatingGroup, setIsCreatingGroup] = useState(false);
  const [selectedGroupMemberIds, setSelectedGroupMemberIds] = useState<string[]>([]);
  const [groupManageError, setGroupManageError] = useState<string | null>(null);
  const [groupActionPending, setGroupActionPending] = useState(false);
  const [showAddGroupMembers, setShowAddGroupMembers] = useState(false);
  const [selectedNewMemberIds, setSelectedNewMemberIds] = useState<string[]>([]);
  const [groupNameDraft, setGroupNameDraft] = useState("");
  const [groupDescriptionDraft, setGroupDescriptionDraft] = useState("");
  const [chatWallpapers, setChatWallpapers] = useState<Record<string, ChatWallpaperSelection>>({});
  const [customWallpaperObjectUrl, setCustomWallpaperObjectUrl] = useState<{
    conversationId: string;
    url: string;
  } | null>(null);
  const [wallpaperLoadVersion, setWallpaperLoadVersion] = useState(0);
  const [wallpaperActionError, setWallpaperActionError] = useState<string | null>(null);
  const [wallpaperActionPending, setWallpaperActionPending] = useState(false);
  const [disappearingTimerPending, setDisappearingTimerPending] = useState(false);
  const [customDisappearingTimerHours, setCustomDisappearingTimerHours] = useState("1");
  const [isCustomDisappearingTimerSelected, setIsCustomDisappearingTimerSelected] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>(() => storage.getDrafts(currentUser.id));
  const draftsRef = useRef(drafts);
  const [inputText, setInputTextState] = useState(() => drafts[activeConversationId] ?? "");
  const inputTextRef = useRef(inputText);
  const draftConversationIdRef = useRef(activeConversationId);
  const isEditingMessageRef = useRef(false);
  const [draftSaveError, setDraftSaveError] = useState<string | null>(null);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [dismissedComposerLinkUrl, setDismissedComposerLinkUrl] = useState<string | null>(null);
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [activeEmojiTab, setActiveEmojiTab] = useState<string>("smileys");
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const [isRecordingVoice, setIsRecordingVoice] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [scheduledDateTime, setScheduledDateTime] = useState("");
  const [scheduleFormError, setScheduleFormError] = useState<string | null>(null);
  const [isSchedulingMessage, setIsSchedulingMessage] = useState(false);
  const [mobileChatOpen, setMobileChatOpen] = useState(false);
  const [pendingLocalUnlockChatId, setPendingLocalUnlockChatId] = useState<string | null>(null);
  const [isUpdatingChatLock, setIsUpdatingChatLock] = useState(false);
  const [peerTyping, setPeerTyping] = useState<Record<string, { id?: string; displayName?: string }>>({});
  const [registeredUsers, setRegisteredUsers] = useState<User[]>([]);
  const typingDebounceRef = useRef<number | null>(null);
  const typingTimersRef = useRef(new Map<string, number>());
  const typingConversationRef = useRef<string | null>(null);

  function saveDraftForConversation(conversationId: string, text: string) {
    if (!conversationId) return;

    const updatedDrafts = { ...draftsRef.current };
    if (text.length > 0) {
      updatedDrafts[conversationId] = text;
    } else {
      delete updatedDrafts[conversationId];
    }

    draftsRef.current = updatedDrafts;
    setDrafts(updatedDrafts);
    try {
      storage.saveDrafts(currentUser.id, updatedDrafts);
      setDraftSaveError(null);
    } catch {
      setDraftSaveError("Your draft could not be saved in this browser.");
    }
  }

  function setInputText(nextText: string | ((previous: string) => string)) {
    const updatedText = typeof nextText === "function" ? nextText(inputTextRef.current) : nextText;
    inputTextRef.current = updatedText;
    setInputTextState(updatedText);
    if (!isEditingMessageRef.current) {
      saveDraftForConversation(draftConversationIdRef.current, updatedText);
    }
  }

  // New WhatsApp Messaging Features State
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const [showInChatSearch, setShowInChatSearch] = useState(false);
  const [inChatSearchQuery, setInChatSearchQuery] = useState("");
  const [activeSearchMatchIndex, setActiveSearchMatchIndex] = useState(0);
  const [showContactInfoDrawer, setShowContactInfoDrawer] = useState(false);
  const [activeMenuMsgId, setActiveMenuMsgId] = useState<string | null>(null);
  const [dismissedReactionToolbarMsgId, setDismissedReactionToolbarMsgId] = useState<string | null>(null);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [forwardModalMessages, setForwardModalMessages] = useState<Message[]>([]);
  const [isSelectingForwardMessages, setIsSelectingForwardMessages] = useState(false);
  const [forwardRecipientIds, setForwardRecipientIds] = useState<string[]>([]);
  const [forwardSearchQuery, setForwardSearchQuery] = useState("");
  const [forwardCaption, setForwardCaption] = useState("");
  const [showContactShareModal, setShowContactShareModal] = useState(false);
  const [contactNameDraft, setContactNameDraft] = useState("");
  const [contactPhoneDraft, setContactPhoneDraft] = useState("");
  const [contactEmailDraft, setContactEmailDraft] = useState("");
  const [contactShareError, setContactShareError] = useState<string | null>(null);
  const [isPickingDeviceContact, setIsPickingDeviceContact] = useState(false);
  const [deleteConfirmMsg, setDeleteConfirmMsg] = useState<Message | null>(null);
  const [showPollModal, setShowPollModal] = useState(false);
  const [pollQuestion, setPollQuestion] = useState("");
  const [pollOptions, setPollOptions] = useState<PollOptionDraft[]>(() => [
    createPollOptionDraft(),
    createPollOptionDraft(),
  ]);
  const [pollAllowMultiple, setPollAllowMultiple] = useState(false);
  const [pollFormError, setPollFormError] = useState<string | null>(null);
  const [pendingPollVoteId, setPendingPollVoteId] = useState<string | null>(null);
  const [infoModalMsg, setInfoModalMsg] = useState<Message | null>(null);
  const [infoReadReceipts, setInfoReadReceipts] = useState<MessageReadReceipt[]>([]);
  const [infoReadReceiptsLoading, setInfoReadReceiptsLoading] = useState(false);
  const [infoReadReceiptsError, setInfoReadReceiptsError] = useState<string | null>(null);
  const infoReadReceiptRequestId = useRef(0);
  const [copiedToast, setCopiedToast] = useState<string | null>(null);
  const [manualInviteUrl, setManualInviteUrl] = useState<string | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [isLookingUp, setIsLookingUp] = useState(false);
  const composerLinks = getLinkPreviews(inputText);
  const composerLinkPreviews = composerLinks.some((link) => link.url === dismissedComposerLinkUrl)
    ? []
    : composerLinks;

  const refreshInfoReadReceipts = useCallback(async () => {
    const message = infoModalMsg;
    const requestId = ++infoReadReceiptRequestId.current;
    if (!message || message.senderId !== currentUser.id) {
      setInfoReadReceipts([]);
      setInfoReadReceiptsError(null);
      setInfoReadReceiptsLoading(false);
      return;
    }

    setInfoReadReceiptsLoading(true);
    setInfoReadReceipts([]);
    setInfoReadReceiptsError(null);
    try {
      const response = await fetch(
        `/api/conversations/${encodeURIComponent(message.conversationId)}/messages/${encodeURIComponent(message.id)}/read-receipts`,
      );
      const result = await response.json() as {
        receipts?: MessageReadReceipt[];
        error?: { message?: string };
      };
      if (!response.ok || !Array.isArray(result.receipts)) {
        throw new Error(result.error?.message || "Could not load receipt details.");
      }
      if (requestId === infoReadReceiptRequestId.current) {
        setInfoReadReceipts(result.receipts);
      }
    } catch (error) {
      if (requestId === infoReadReceiptRequestId.current) {
        setInfoReadReceiptsError(
          error instanceof Error ? error.message : "Could not load receipt details.",
        );
      }
    } finally {
      if (requestId === infoReadReceiptRequestId.current) {
        setInfoReadReceiptsLoading(false);
      }
    }
  }, [currentUser.id, infoModalMsg]);

  useEffect(() => {
    void refreshInfoReadReceipts();
  }, [refreshInfoReadReceipts]);

  useEffect(() => {
    if (!infoModalMsg || infoModalMsg.senderId !== currentUser.id) return;
    return realtime.subscribe("chat:read", (data: { messageIds?: string[] }) => {
      if (data.messageIds?.includes(infoModalMsg.id)) void refreshInfoReadReceipts();
    });
  }, [currentUser.id, infoModalMsg, refreshInfoReadReceipts]);

  async function shareMyInviteLink() {
    setManualInviteUrl(null);
    try {
      const inviteUrl = createInviteLink(currentUser.username, window.location.origin);
      const result = await shareInviteUrl(inviteUrl);
      if (result === "manual") {
        setManualInviteUrl(inviteUrl);
      } else if (result !== "cancelled") {
        setCopiedToast(result === "copied" ? "Invite link copied." : "Invite link shared.");
        window.setTimeout(() => setCopiedToast(null), 2500);
      }
    } catch (error) {
      setCopiedToast(error instanceof Error ? error.message : "Could not create an invite link.");
      window.setTimeout(() => setCopiedToast(null), 2500);
    }
  }

  useEffect(() => {
    fetch("/api/auth/users")
      .then((res) => res.json())
      .then((data) => {
        if (data?.users && Array.isArray(data.users)) {
          const others = data.users.filter(
            (u: User) => u.id !== currentUser.id && (!currentUser.email || u.email !== currentUser.email)
          );
          setRegisteredUsers(others);
        }
      })
      .catch(() => { });
  }, [currentUser.id, currentUser.email]);

  async function handleStartChatWithUser(u: User) {
    const existing = conversations.find(
      (c) =>
        (u.id && c.peerUserId === u.id) ||
        (u.email && c.peerEmail === u.email) ||
        (u.displayName && c.name.toLowerCase() === u.displayName.toLowerCase())
    );
    if (existing) {
      onSelectConversation(existing.id);
      setMobileChatOpen(true);
      setShowNewChatModal(false);
      setLookupError(null);
      return;
    }
    const isConnected = conversations.some(
      (conversation) => conversation.type === "direct" && conversation.peerUserId === u.id,
    );
    if (!isConnected) {
      setLookupError("Send a connection request from Contacts before starting a chat.");
      onOpenContacts?.();
      return;
    }
    const newConv: Conversation = {
      id: "",
      type: "direct",
      name: u.displayName || u.username || u.email || "Member",
      avatar: getSafeAvatar(u.avatar, u.displayName),
      peerUserId: u.id,
      peerEmail: u.email,
      peerPhone: u.phone,
      isOnline: true,
      lastSeen: "Online now",
      unreadCount: 0,
      description: u.bio || (u.email ? `Email: ${u.email}` : "ConnectSphere Member"),
    };
    try {
      const created = await onAddConversation?.(newConv);
      if (!created || !created.id) throw new Error("The conversation was not created. Please try again.");
      onSelectConversation(created.id);
      setMobileChatOpen(true);
      setShowNewChatModal(false);
      setLookupError(null);
    } catch (error) {
      setLookupError(error instanceof Error ? error.message : "Could not create conversation.");
    }
  }

  const messagesStreamRef = useRef<HTMLDivElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const recordingTimerRef = useRef<number | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  const activeConv = conversations.find((c) => c.id === activeConversationId) ?? conversations[0];
  const activeChatWallpaper = activeConv
    ? chatWallpapers[activeConv.id] ?? storage.getChatWallpaper(activeConv.id)
    : DEFAULT_CHAT_WALLPAPER;
  const customWallpaperUrl = customWallpaperObjectUrl && customWallpaperObjectUrl.conversationId === activeConv?.id
    ? customWallpaperObjectUrl.url
    : null;
  const allActiveMessages = activeConv ? messages[activeConv.id] ?? [] : [];
  useEffect(() => {
    const now = Date.now();
    const nextExpiry = allActiveMessages.reduce<number | null>((nearest, message) => {
      if (!message.expiresAt) return nearest;
      const expiresAt = Date.parse(message.expiresAt);
      if (expiresAt <= now) return nearest;
      return nearest === null ? expiresAt : Math.min(nearest, expiresAt);
    }, null);
    if (nextExpiry === null) return;
    const timer = window.setTimeout(
      () => setLastSeenClock(Date.now()),
      Math.max(0, nextExpiry - now),
    );
    return () => window.clearTimeout(timer);
  }, [allActiveMessages]);
  const activePeerTyping = activeConv ? peerTyping[activeConv.id] : undefined;
  const minimumScheduledDateTime = formatDateTimeLocal(new Date(Date.now() + 60_000));
  const hasValidScheduledDateTime = Boolean(
    scheduledDateTime && Date.parse(scheduledDateTime) > Date.now()
  );

  useEffect(() => {
    setGroupNameDraft(activeConv?.name ?? "");
    setGroupDescriptionDraft(activeConv?.description ?? "");
    setGroupManageError(null);
    setShowAddGroupMembers(false);
    setSelectedNewMemberIds([]);
  }, [activeConv?.id, activeConv?.name, activeConv?.description]);

  useEffect(() => {
    const conversationId = activeConv?.id;
    if (!conversationId) return;

    let active = true;
    let objectUrl: string | null = null;
    setWallpaperActionError(null);
    setCustomWallpaperObjectUrl(null);
    void storage.getCustomChatWallpaper(conversationId).then((wallpaper) => {
      if (!active || !wallpaper) return;
      objectUrl = URL.createObjectURL(wallpaper);
      setCustomWallpaperObjectUrl({ conversationId, url: objectUrl });
    }).catch((error: unknown) => {
      console.error("Could not load this conversation's custom wallpaper:", error);
      if (active) {
        setWallpaperActionError(
          error instanceof Error ? error.message : "Could not load this chat's custom background."
        );
      }
    });

    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [activeConv?.id, wallpaperLoadVersion]);

  useEffect(() => {
    setScheduledDateTime("");
    setScheduleFormError(null);
    setShowScheduleModal(false);
    setShowContactShareModal(false);
  }, [activeConversationId]);

  useLayoutEffect(() => {
    const previousConversationId = draftConversationIdRef.current;
    if (previousConversationId === activeConversationId) return;

    if (!isEditingMessageRef.current) {
      saveDraftForConversation(previousConversationId, inputTextRef.current);
    }

    draftConversationIdRef.current = activeConversationId;
    isEditingMessageRef.current = false;
    setEditingMessageId(null);
    setDismissedComposerLinkUrl(null);
    const nextDraft = draftsRef.current[activeConversationId] ?? "";
    inputTextRef.current = nextDraft;
    setInputTextState(nextDraft);
  }, [activeConversationId]);

  useEffect(() => {
    const timerHours = activeConv?.disappearingTimerHours ?? 0;
    const isCustomTimer = timerHours > 0 && ![1, 24, 168, 720].includes(timerHours);
    setIsCustomDisappearingTimerSelected(isCustomTimer);
    setCustomDisappearingTimerHours(
      isCustomTimer ? String(timerHours) : "1"
    );
  }, [activeConv?.id, activeConv?.disappearingTimerHours]);

  // Filter out messages deleted for current user
  const activeMessages = allActiveMessages.filter(
    (m) =>
      !m.deletedForUserIds?.includes(currentUser.id) &&
      (!m.expiresAt || Date.parse(m.expiresAt) > Date.now())
  );
  const pinnedMessage = activeMessages.find((message) => message.isPinned);

  // Close message context menu when clicking outside
  useEffect(() => {
    function handleClickOutside() {
      if (activeMenuMsgId) setActiveMenuMsgId(null);
    }
    window.addEventListener("click", handleClickOutside);
    return () => window.removeEventListener("click", handleClickOutside);
  }, [activeMenuMsgId]);

  // Listen to realtime typing events from peers
  useEffect(() => {
    const unsub = realtime.subscribe("chat:typing", (data: {
      conversationId?: string;
      isTyping?: boolean;
      user?: { id?: string; displayName?: string };
    }) => {
      const conversationId = data?.conversationId;
      const user = data?.user;
      if (!conversationId || user?.id === currentUser.id) return;

      const timer = typingTimersRef.current.get(conversationId);
      if (timer !== undefined) {
        window.clearTimeout(timer);
        typingTimersRef.current.delete(conversationId);
      }

      if (data.isTyping) {
        setPeerTyping((previous) => ({
          ...previous,
          [conversationId]: {
            ...(user?.id ? { id: user.id } : {}),
            ...(user?.displayName ? { displayName: user.displayName } : {}),
          },
        }));
        const timeout = window.setTimeout(() => {
          setPeerTyping((previous) => {
            const updated = { ...previous };
            if (!user?.id || updated[conversationId]?.id === user.id) delete updated[conversationId];
            return updated;
          });
          typingTimersRef.current.delete(conversationId);
        }, 4_000);
        typingTimersRef.current.set(conversationId, timeout);
      } else {
        setPeerTyping((previous) => {
          const current = previous[conversationId];
          if (!current || (user?.id && current.id !== user.id)) return previous;
          const updated = { ...previous };
          delete updated[conversationId];
          return updated;
        });
      }
    });
    return () => {
      unsub();
      for (const timer of typingTimersRef.current.values()) window.clearTimeout(timer);
      typingTimersRef.current.clear();
    };
  }, [currentUser.id]);

  useEffect(() => {
    const previousConversationId = typingConversationRef.current;
    if (previousConversationId && previousConversationId !== activeConv?.id) {
      if (typingDebounceRef.current !== null) {
        window.clearTimeout(typingDebounceRef.current);
        typingDebounceRef.current = null;
      }
      realtime.sendTyping(previousConversationId, false);
    }
    typingConversationRef.current = activeConv?.id ?? null;
  }, [activeConv?.id]);

  useEffect(() => {
    if (activeConv?.type !== "group") return;
    let cancelled = false;
    const refreshGroup = async () => {
      try {
        const response = await fetch("/api/conversations");
        const result = await response.json() as { conversations?: Conversation[] };
        if (!response.ok || !result.conversations || cancelled) return;
        const refreshed = result.conversations.find((conversation) => conversation.id === activeConv.id);
        if (refreshed) {
          onUpdateConversations?.((previous) =>
            previous.map((conversation) => conversation.id === refreshed.id ? refreshed : conversation)
          );
        } else {
          const nextConversation = result.conversations[0];
          onUpdateConversations?.((previous) =>
            previous.filter((conversation) => conversation.id !== activeConv.id)
          );
          onSelectConversation(nextConversation?.id ?? "");
          setShowContactInfoDrawer(false);
          setMobileChatOpen(false);
        }
      } catch (error) {
        console.warn("Could not refresh group details.", error);
      }
    };
    const interval = window.setInterval(() => void refreshGroup(), 10_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [activeConv?.id, activeConv?.type, onUpdateConversations]);

  const scrollToBottom = useCallback((smooth = true) => {
    if (messagesStreamRef.current) {
      messagesStreamRef.current.scrollTo({
        top: messagesStreamRef.current.scrollHeight,
        behavior: smooth ? "smooth" : "auto",
      });
    }
    messagesEndRef.current?.scrollIntoView({
      behavior: smooth ? "smooth" : "auto",
      block: "end",
    });
  }, []);

  // Keep the latest message in view after React commits the updated message list.
  useLayoutEffect(() => {
    scrollToBottom(false);
    const frame = window.requestAnimationFrame(() => scrollToBottom(false));
    return () => window.cancelAnimationFrame(frame);
  }, [activeMessages.length, activeMessages.at(-1)?.id, activeConversationId, scrollToBottom]);

  // Auto-scroll when someone is typing so typing indicator is immediately visible
  useEffect(() => {
    if (activePeerTyping) {
      scrollToBottom(true);
      const t1 = window.setTimeout(() => scrollToBottom(true), 40);
      const t2 = window.setTimeout(() => scrollToBottom(true), 120);
      return () => {
        window.clearTimeout(t1);
        window.clearTimeout(t2);
      };
    }
  }, [activePeerTyping, scrollToBottom]);

  // Synchronize mobile chat state with body class for responsive styling
  useEffect(() => {
    document.body.classList.toggle("in-mobile-chat", mobileChatOpen);
    return () => {
      document.body.classList.remove("in-mobile-chat");
    };
  }, [mobileChatOpen]);

  useEffect(() => {
    if (!mobileChatOpen || !window.matchMedia("(max-width: 768px)").matches) return;

    const visualViewport = window.visualViewport;
    const updateVisibleHeight = () => {
      const height = visualViewport?.height ?? window.innerHeight;
      document.documentElement.style.setProperty("--mobile-visual-height", `${height}px`);
    };

    updateVisibleHeight();
    visualViewport?.addEventListener("resize", updateVisibleHeight);
    window.addEventListener("resize", updateVisibleHeight);
    return () => {
      visualViewport?.removeEventListener("resize", updateVisibleHeight);
      window.removeEventListener("resize", updateVisibleHeight);
      document.documentElement.style.removeProperty("--mobile-visual-height");
    };
  }, [mobileChatOpen]);

  useEffect(() => {
    const updateVisibleConversation = () => {
      const isMobile = window.matchMedia("(max-width: 768px)").matches;
      onVisibleConversationChange?.(
        activeConv && (!isMobile || mobileChatOpen) ? activeConv.id : null
      );
    };

    updateVisibleConversation();
    window.addEventListener("resize", updateVisibleConversation);
    return () => {
      window.removeEventListener("resize", updateVisibleConversation);
      onVisibleConversationChange?.(null);
    };
  }, [activeConv?.id, mobileChatOpen, onVisibleConversationChange]);

  // Handle voice recording timer
  useEffect(() => {
    if (isRecordingVoice) {
      setRecordingSeconds(0);
      recordingTimerRef.current = window.setInterval(() => {
        setRecordingSeconds((s) => s + 1);
      }, 1000);
    } else {
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
    }
    return () => {
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
    };
  }, [isRecordingVoice]);

  // Filter conversations
  const filteredConversations = conversations.filter((c) => {
    const matchesSearch = c.name.toLowerCase().includes(searchQuery.toLowerCase());
    if (!matchesSearch) return false;
    if (filterType === "direct") return c.type === "direct";
    if (filterType === "group") return c.type === "group" || c.type === "community-channel";
    if (filterType === "unread") {
      const convMsgs = messages[c.id] ?? [];
      const unreadCount = convMsgs.filter(
        (m) => m.senderId !== currentUser.id && m.status !== "read"
      ).length;
      return unreadCount > 0;
    }
    if (filterType === "pinned") return c.isPinned;
    return true;
  });

  async function handleCreateNewChat(e: FormEvent) {
    e.preventDefault();
    if (newChatType === "group" && !newChatName.trim()) {
      setLookupError("Enter a group name to continue.");
      return;
    }
    if (!newChatName.trim()) return;
    const query = newChatName.trim();
    setLookupError(null);

    if (newChatType === "direct") {
      setIsLookingUp(true);
      try {
        const res = await fetch(`/api/auth/lookup?query=${encodeURIComponent(query)}`);
        const data = await res.json() as { exists?: boolean; user?: User; error?: { message?: string } };
        const foundUser = res.ok && data.exists ? data.user : null;

        if (foundUser) {
          await handleStartChatWithUser(foundUser);
          setNewChatName("");
          setShowNewChatModal(false);
          setLookupError(null);
        } else {
          setLookupError(`No registered user matches "${query}". Search for them in Contacts to send a connection request.`);
        }
      } catch (error) {
        setLookupError(error instanceof Error ? error.message : "Could not search for this contact.");
      } finally {
        setIsLookingUp(false);
      }
    } else {
      if (selectedGroupMemberIds.length === 0) {
        setLookupError("Choose at least one member to create a group.");
        return;
      }
      const newConv: Conversation = {
        id: "",
        type: "group",
        name: query,
        avatar: "/avatars/robot.png",
        isOnline: true,
        lastSeen: "Group Chat",
        unreadCount: 0,
        description: "",
        members: registeredUsers
          .filter((user) => selectedGroupMemberIds.includes(user.id))
          .map((user) => ({
            id: user.id,
            name: user.displayName,
            avatar: getSafeAvatar(user.avatar, user.displayName),
            role: "member",
          })),
      };
      setIsCreatingGroup(true);
      try {
        const created = await onAddConversation?.(newConv);
        if (!created || !created.id) throw new Error("The group was not created. Please try again.");
        onSelectConversation(created.id);
        setMobileChatOpen(true);
        setShowNewChatModal(false);
        setNewChatName("");
        setSelectedGroupMemberIds([]);
      } catch (error) {
        setLookupError(error instanceof Error ? error.message : "Could not create the group.");
      } finally {
        setIsCreatingGroup(false);
      }
    }
  }

  function saveActiveChatWallpaper(conversationId: string, wallpaper: ChatWallpaperSelection) {
    storage.saveChatWallpaper(conversationId, wallpaper);
    setChatWallpapers((previous) => ({ ...previous, [conversationId]: wallpaper }));
  }

  function handleChangeChatWallpaper(wallpaper: ChatWallpaperSelection) {
    if (!activeConv) return;
    setWallpaperActionError(null);
    saveActiveChatWallpaper(activeConv.id, wallpaper);
  }

  async function handleCustomWallpaperFileChange(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = "";
    if (!file || !activeConv) return;

    setWallpaperActionError(null);
    if (!CUSTOM_WALLPAPER_MIME_TYPES.has(file.type)) {
      setWallpaperActionError("Choose a PNG, JPEG, WebP, or AVIF image.");
      return;
    }
    if (file.size > MAX_CUSTOM_WALLPAPER_BYTES) {
      setWallpaperActionError("Choose an image that is 10 MB or smaller.");
      return;
    }

    const conversationId = activeConv.id;
    setWallpaperActionPending(true);
    try {
      await storage.saveCustomChatWallpaper(conversationId, file);
      saveActiveChatWallpaper(conversationId, CUSTOM_CHAT_WALLPAPER_ID);
      setWallpaperLoadVersion((version) => version + 1);
    } catch (error) {
      setWallpaperActionError(
        error instanceof Error ? error.message : "Could not save this chat's custom background."
      );
    } finally {
      setWallpaperActionPending(false);
    }
  }

  async function handleRemoveCustomChatWallpaper() {
    if (!activeConv) return;
    const conversationId = activeConv.id;
    setWallpaperActionError(null);
    setWallpaperActionPending(true);
    try {
      await storage.removeCustomChatWallpaper(conversationId);
      saveActiveChatWallpaper(conversationId, DEFAULT_CHAT_WALLPAPER);
      setWallpaperLoadVersion((version) => version + 1);
    } catch (error) {
      setWallpaperActionError(
        error instanceof Error ? error.message : "Could not remove this chat's custom background."
      );
    } finally {
      setWallpaperActionPending(false);
    }
  }

  async function refreshConversation(conversationId: string) {
    const response = await fetch("/api/conversations");
    const result = await response.json() as { conversations?: Conversation[]; error?: { message?: string } };
    if (!response.ok || !result.conversations) {
      throw new Error(result.error?.message || "Could not refresh group details.");
    }
    const refreshed = result.conversations.find((conversation) => conversation.id === conversationId);
    if (!refreshed) throw new Error("Group is no longer available.");
    onUpdateConversations?.((previous) =>
      previous.map((conversation) => conversation.id === conversationId ? refreshed : conversation)
    );
    return refreshed;
  }

  async function manageGroupRequest(
    url: string,
    method: "PATCH" | "POST" | "DELETE",
    body?: unknown,
    refresh = true,
  ) {
    if (!activeConv) return;
    setGroupActionPending(true);
    setGroupManageError(null);
    try {
      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      const result = await response.json() as { error?: { message?: string } };
      if (!response.ok) throw new Error(result.error?.message || "Group update failed.");
      if (refresh) await refreshConversation(activeConv.id);
      return true;
    } catch (error) {
      setGroupManageError(error instanceof Error ? error.message : "Group update failed.");
      return false;
    } finally {
      setGroupActionPending(false);
    }
  }

  async function handleSaveGroupDetails() {
    if (!activeConv) return;
    const saved = await manageGroupRequest(`/api/conversations/${encodeURIComponent(activeConv.id)}`, "PATCH", {
      name: groupNameDraft.trim(),
      description: groupDescriptionDraft,
    });
    if (saved) setGroupNameDraft("");
  }

  async function handleAddMembers() {
    if (!activeConv || selectedNewMemberIds.length === 0) return;
    const saved = await manageGroupRequest(
      `/api/conversations/${encodeURIComponent(activeConv.id)}/members`,
      "POST",
      { memberIds: selectedNewMemberIds },
    );
    if (saved) {
      setSelectedNewMemberIds([]);
      setShowAddGroupMembers(false);
    }
  }

  async function handleRemoveGroupMember(memberId: string) {
    if (!activeConv) return;
    if (!window.confirm("Remove this member from the group?")) return;
    await manageGroupRequest(
      `/api/conversations/${encodeURIComponent(activeConv.id)}/members/${encodeURIComponent(memberId)}`,
      "DELETE",
    );
  }

  async function handleLeaveGroup() {
    if (!activeConv || !window.confirm("Leave this group? You will no longer receive its messages.")) return;
    const left = await manageGroupRequest(
      `/api/conversations/${encodeURIComponent(activeConv.id)}/members/${encodeURIComponent(currentUser.id)}`,
      "DELETE",
      undefined,
      false,
    );
    if (left) {
      setShowContactInfoDrawer(false);
      const remaining = conversations.filter((conversation) => conversation.id !== activeConv.id);
      onUpdateConversations?.(() => remaining);
      onSelectConversation(remaining[0]?.id ?? "");
      setMobileChatOpen(false);
    }
  }

  function clearScheduleForImmediateSend() {
    if (!scheduledDateTime) return;
    setScheduledDateTime("");
    setScheduleFormError(null);
    setCopiedToast("Scheduled time cleared; this message type sends immediately.");
    setTimeout(() => setCopiedToast(null), 3000);
  }

  function handleConfirmScheduleTime() {
    if (!hasValidScheduledDateTime) {
      setScheduleFormError("Choose a delivery time in the future.");
      return;
    }
    setScheduleFormError(null);
    setShowScheduleModal(false);
  }

  async function handleSend() {
    if (!inputText.trim() || !activeConv) return;
    const conversationId = activeConv.id;
    const messageText = inputText.trim();
    if (editingMessageId) {
      const message = (messages[conversationId] ?? []).find((item) => item.id === editingMessageId);
      if (!message || message.isDeleted || message.senderId !== currentUser.id) {
        isEditingMessageRef.current = false;
        setEditingMessageId(null);
        const savedDraft = draftsRef.current[conversationId] ?? "";
        inputTextRef.current = savedDraft;
        setInputTextState(savedDraft);
        setCopiedToast("This message can no longer be edited.");
        window.setTimeout(() => setCopiedToast(null), 3000);
        return;
      }

      setIsSavingEdit(true);
      try {
        const response = await fetch(
          `/api/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(message.id)}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: messageText }),
          },
        );
        const result = await response.json() as { error?: { message?: string } };
        if (!response.ok) {
          throw new Error(result.error?.message || "Could not edit this message.");
        }

        const editedMessage = { ...message, text: messageText, isEdited: true };
        onUpdateMessages?.((previous) => ({
          ...previous,
          [conversationId]: (previous[conversationId] ?? []).map((item) =>
            item.id === message.id ? editedMessage : item
          ),
        }));
        onUpdateConversations?.((previous) => previous.map((conversation) =>
          conversation.id === conversationId && conversation.lastMessage?.id === message.id
            ? { ...conversation, lastMessage: editedMessage }
            : conversation
        ));
        realtime.send(
          "chat:edit",
          { messageId: message.id, conversationId, text: messageText, isEdited: true },
          conversationId,
        );
        isEditingMessageRef.current = false;
        setEditingMessageId(null);
        if (activeConversationId === conversationId) {
          const savedDraft = draftsRef.current[conversationId] ?? "";
          inputTextRef.current = savedDraft;
          setInputTextState(savedDraft);
          setDismissedComposerLinkUrl(null);
        }
        setCopiedToast("Message edited.");
        window.setTimeout(() => setCopiedToast(null), 2000);
      } catch (error) {
        setCopiedToast(error instanceof Error ? error.message : "Could not edit this message.");
        window.setTimeout(() => setCopiedToast(null), 3000);
      } finally {
        setIsSavingEdit(false);
      }
      return;
    }

    if (typingDebounceRef.current !== null) {
      window.clearTimeout(typingDebounceRef.current);
      typingDebounceRef.current = null;
    }
    realtime.sendTyping(conversationId, false);

    const extra: Partial<Message> = {};
    if (replyingTo) {
      extra.replyTo = {
        id: replyingTo.id,
        senderName: replyingTo.senderName,
        text: replyingTo.text,
      };
    }
    if (getLinkPreviews(messageText).some((link) => link.url === dismissedComposerLinkUrl)) {
      extra.linkPreviewDisabled = true;
    }
    if (scheduledDateTime) {
      const scheduledDate = new Date(scheduledDateTime);
      if (Number.isNaN(scheduledDate.getTime()) || scheduledDate.getTime() <= Date.now()) {
        setScheduleFormError("That delivery time has passed. Choose a new time.");
        setShowScheduleModal(true);
        return;
      }

      setIsSchedulingMessage(true);
      try {
        await onScheduleMessage(
          conversationId,
          messageText,
          scheduledDate.toISOString(),
          extra.replyTo ? { replyTo: extra.replyTo } : undefined,
        );
        saveDraftForConversation(conversationId, "");
        if (activeConversationId === conversationId) {
          inputTextRef.current = "";
          setInputTextState("");
          setDismissedComposerLinkUrl(null);
          setReplyingTo(null);
          setScheduledDateTime("");
          setShowEmojiPicker(false);
        }
        setCopiedToast(`Message scheduled for ${formatScheduledDateTime(scheduledDate.toISOString())}.`);
        setTimeout(() => setCopiedToast(null), 3500);
      } catch (error) {
        setCopiedToast(error instanceof Error ? error.message : "Could not schedule this message.");
        setTimeout(() => setCopiedToast(null), 3500);
      } finally {
        setIsSchedulingMessage(false);
      }
      return;
    }

    try {
      if (await onSendMessage(conversationId, messageText, extra) === false) {
        setCopiedToast("Message could not be sent. Your draft is still available.");
        window.setTimeout(() => setCopiedToast(null), 3000);
        return;
      }
    } catch (error) {
      setCopiedToast(error instanceof Error ? error.message : "Message could not be sent. Your draft is still available.");
      window.setTimeout(() => setCopiedToast(null), 3000);
      return;
    }

    saveDraftForConversation(conversationId, "");
    if (activeConversationId === conversationId) {
      inputTextRef.current = "";
      setInputTextState("");
      setDismissedComposerLinkUrl(null);
      setReplyingTo(null);
      setShowEmojiPicker(false);
      setShowScheduleModal(false);
      setScheduledDateTime("");
    }
  }

  // --- Real File & Image Upload Handlers ---
  function handleTriggerPhotoUpload() {
    setShowAttachMenu(false);
    imageInputRef.current?.click();
  }

  function handleTriggerDocumentUpload() {
    setShowAttachMenu(false);
    fileInputRef.current?.click();
  }

  function handleOpenContactShareModal() {
    setShowAttachMenu(false);
    setContactNameDraft("");
    setContactPhoneDraft("");
    setContactEmailDraft("");
    setContactShareError(null);
    setShowContactShareModal(true);
  }

  async function handlePickDeviceContact() {
    const picker = (navigator as ContactPickerNavigator).contacts;
    if (!picker) {
      setContactShareError("Device contact selection isn't supported here. Enter the details manually.");
      return;
    }

    setIsPickingDeviceContact(true);
    setContactShareError(null);
    try {
      const [contact] = await picker.select(["name", "tel", "email"], { multiple: false });
      if (!contact) return;
      setContactNameDraft(contact.name?.[0] ?? "");
      setContactPhoneDraft(contact.tel?.[0] ?? "");
      setContactEmailDraft(contact.email?.[0] ?? "");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setContactShareError(error instanceof Error
        ? `Could not read the selected contact: ${error.message}`
        : "Could not read the selected contact. Enter the details manually.");
    } finally {
      setIsPickingDeviceContact(false);
    }
  }

  function handleShareContact(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeConv) return;
    const name = contactNameDraft.trim();
    const phone = contactPhoneDraft.trim();
    const email = contactEmailDraft.trim();
    if (!name || (!phone && !email)) {
      setContactShareError("Enter a contact name and at least a phone number or email address.");
      return;
    }
    if (phone && (!/^\+?[0-9().\-\s]+$/.test(phone) || (phone.match(/\d/g)?.length ?? 0) < 3)) {
      setContactShareError("Enter a valid phone number or remove it before sharing.");
      return;
    }

    const sharedContact: SharedContact = {
      name,
      ...(phone ? { phone } : {}),
      ...(email ? { email } : {}),
    };
    clearScheduleForImmediateSend();
    onSendMessage(activeConv.id, "", { sharedContact });
    setShowContactShareModal(false);
    setContactShareError(null);
  }

  async function handleCopyContactValue(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedToast("Contact detail copied.");
      window.setTimeout(() => setCopiedToast(null), 2500);
    } catch (error) {
      setCopiedToast(error instanceof Error
        ? `Could not copy contact detail: ${error.message}`
        : "Could not copy contact detail.");
      window.setTimeout(() => setCopiedToast(null), 3000);
    }
  }

  function handleDownloadContactVCard(contact: SharedContact) {
    try {
      const escapeField = (value: string) =>
        value.replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
      const fields = [
        "BEGIN:VCARD",
        "VERSION:3.0",
        `FN:${escapeField(contact.name)}`,
        ...(contact.phone ? [`TEL;TYPE=CELL:${escapeField(contact.phone)}`] : []),
        ...(contact.email ? [`EMAIL:${escapeField(contact.email)}`] : []),
        "END:VCARD",
      ];
      const objectUrl = URL.createObjectURL(new Blob([fields.join("\r\n")], { type: "text/vcard;charset=utf-8" }));
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = `${contact.name.replace(/[^a-z0-9_-]+/gi, "-") || "contact"}.vcf`;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } catch (error) {
      setCopiedToast(error instanceof Error ? `Could not save contact: ${error.message}` : "Could not save contact.");
      window.setTimeout(() => setCopiedToast(null), 3000);
    }
  }

  async function handleFileInputChange(e: React.ChangeEvent<HTMLInputElement>, type: "image" | "file") {
    const files = e.target.files;
    if (!files || files.length === 0 || !activeConv) return;
    const file = files[0];
    if (!file) return;
    const input = e.currentTarget;
    const conversationId = activeConv.id;
    const attachmentType = type === "image" && file.type.startsWith("video/")
      ? "video"
      : type === "file" && file.type.startsWith("image/")
        ? "image"
        : type === "file" && file.type.startsWith("video/")
          ? "video"
          : type;
    const formatSize = (bytes: number) => {
      if (bytes < 1024) return bytes + " B";
      if (bytes < 1024 ** 2) return (bytes / 1024).toFixed(1) + " KB";
      if (bytes < 1024 ** 3) return (bytes / 1024 ** 2).toFixed(1) + " MB";
      if (bytes < 1024 ** 4) return (bytes / 1024 ** 3).toFixed(1) + " GB";
      return (bytes / 1024 ** 4).toFixed(1) + " TB";
    };

    try {
      const attachmentId = crypto.randomUUID();
      const response = await fetch(
        `/api/conversations/${encodeURIComponent(conversationId)}/attachments/${encodeURIComponent(attachmentId)}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/octet-stream",
            "X-File-Name": encodeURIComponent(file.name),
            "X-File-Content-Type": file.type || "application/octet-stream",
            "X-Attachment-Type": attachmentType,
          },
          body: file,
        },
      );
      const result = await response.json() as {
        attachment?: { id: string; storage: "r2"; url: string };
        error?: { message?: string };
      };
      if (!response.ok || !result.attachment) {
        throw new Error(result.error?.message || "Could not upload this attachment.");
      }

      const caption = inputText.trim();
      if (caption) setInputText("");
      clearScheduleForImmediateSend();
      onSendMessage(conversationId, caption, {
        id: crypto.randomUUID(),
        attachments: [{
          ...result.attachment,
          type: attachmentType,
          name: file.name,
          size: formatSize(file.size),
        }],
      });
    } catch (error) {
      setCopiedToast(error instanceof Error ? error.message : "Could not upload this attachment.");
      setTimeout(() => setCopiedToast(null), 3000);
    } finally {
      input.value = "";
    }
  }

  // --- Voice Note Recording Handlers ---
  async function handleStartRecordingVoice() {
    let stream: MediaStream | undefined;
    try {
      if (!window.isSecureContext) {
        throw new Error(
          "Microphone recording requires HTTPS. This HTTP address blocks microphone access on mobile browsers."
        );
      }
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
        throw new Error("Audio recording is not supported in this browser.");
      }
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      audioChunksRef.current = [];
      mediaRecorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      };
      recorder.start(100);
      setRecordingSeconds(0);
      setIsRecordingVoice(true);
    } catch (error) {
      stream?.getTracks().forEach((track) => track.stop());
      setCopiedToast(error instanceof Error ? error.message : "Microphone access is required to record a voice note.");
    }
  }

  function handleCancelRecordingVoice() {
    setIsRecordingVoice(false);
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      try {
        mediaRecorderRef.current.stop();
        mediaRecorderRef.current.stream.getTracks().forEach((t) => t.stop());
      } catch { }
      mediaRecorderRef.current = null;
    }
    audioChunksRef.current = [];
  }

  async function handleFinishVoiceNote() {
    if (!activeConv) return;
    setIsRecordingVoice(false);
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      await new Promise<void>((resolve) => {
        recorder.addEventListener("stop", () => resolve(), { once: true });
        recorder.stop();
      });
    }
    const duration = Math.max(1, recordingSeconds);
    const mockWaveform = Array.from({ length: 22 }, () => Math.floor(Math.random() * 70) + 25);

    const chunks = [...audioChunksRef.current];
    if (recorder) {
      recorder.stream.getTracks().forEach((track) => track.stop());
    }
    mediaRecorderRef.current = null;
    audioChunksRef.current = [];
    if (chunks.length === 0) {
      setCopiedToast("No audio was recorded. Please try again.");
      return;
    }
    const audioBlob = new Blob(chunks, { type: recorder?.mimeType || "audio/webm" });
    if (audioBlob.size > 3 * 1024 * 1024) {
      setCopiedToast("Voice notes must be 3 MB or smaller.");
      return;
    }
    const audioUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => typeof reader.result === "string"
        ? resolve(reader.result)
        : reject(new Error("Could not read the recorded audio."));
      reader.onerror = () => reject(new Error("Could not read the recorded audio."));
      reader.readAsDataURL(audioBlob);
    }).catch((error: unknown) => {
      setCopiedToast(error instanceof Error ? error.message : "Could not save voice note.");
      return "";
    });
    if (!audioUrl) return;

    clearScheduleForImmediateSend();
    onSendMessage(activeConv.id, "Voice note", {
      voiceNote: {
        durationSec: duration,
        waveform: mockWaveform,
        audioUrl,
      },
    });
  }

  // --- WhatsApp Interactive Poll Handlers ---
  async function handleVotePoll(msgId: string, optionId: string) {
    if (!activeConv) return;
    if (pendingPollVoteId) return;
    const conversationId = activeConv.id;
    const message = (messages[conversationId] ?? []).find((item) => item.id === msgId);
    if (!message?.poll || !message.poll.options.some((option) => option.id === optionId)) return;

    setPendingPollVoteId(msgId);
    try {
      const response = await fetch(
        `/api/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(msgId)}/poll-votes`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ optionId, userId: currentUser.id }),
        }
      );
      const result = await response.json() as { poll?: PollData; error?: { message?: string } };
      if (!response.ok || !result.poll) {
        throw new Error(result.error?.message || "Could not save your poll vote.");
      }

      onUpdateMessages?.((prev) => {
        const list = prev[conversationId];
        if (!list) return prev;
        return {
          ...prev,
          [conversationId]: list.map((item) =>
            item.id === msgId ? { ...item, poll: result.poll } : item
          ),
        };
      });
      realtime.send(
        "chat:poll_vote",
        { messageId: msgId, conversationId, optionId, poll: result.poll },
        conversationId
      );
      soundFx.playReceived();
    } catch (error) {
      setCopiedToast(error instanceof Error ? error.message : "Could not save your poll vote.");
      setTimeout(() => setCopiedToast(null), 2500);
    } finally {
      setPendingPollVoteId(null);
    }
  }

  async function persistMessageUpdate(message: Message) {
    const {
      id,
      conversationId,
      text,
      senderId: _senderId,
      senderName: _senderName,
      senderAvatar: _senderAvatar,
      timestamp: _timestamp,
      status: _status,
      attachments,
      voiceNote,
      ...metadata
    } = message;
    try {
      const response = await fetch(
        `/api/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text,
            metadata,
            attachments: message.isDeleted ? null : attachments ?? null,
            voiceNote: message.isDeleted ? null : voiceNote ?? null,
          }),
        }
      );
      if (!response.ok) {
        const result = await response.json() as { error?: { message?: string } };
        throw new Error(result.error?.message || "Could not save message changes.");
      }
    } catch (error) {
      setCopiedToast(error instanceof Error ? error.message : "Could not save message changes.");
    }
  }

  function handleCreatePollSubmit() {
    if (!activeConv) return;
    const question = pollQuestion.trim();
    const cleanOptions = pollOptions
      .map((option) => ({ id: option.id, text: option.text.trim() }))
      .filter((option) => option.text)
      .map((option) => ({ ...option, votes: [] as string[] }));

    if (cleanOptions.length < 2) {
      setPollFormError("Add at least two options with text.");
      return;
    }
    if (new Set(cleanOptions.map((option) => option.text.toLocaleLowerCase())).size !== cleanOptions.length) {
      setPollFormError("Each option must be different.");
      return;
    }
    if (!question) {
      setPollFormError("Enter a question for your poll.");
      return;
    }

    const pollData: PollData = {
      question,
      options: cleanOptions,
      multipleAnswers: pollAllowMultiple,
    };

    clearScheduleForImmediateSend();
    onSendMessage(activeConv.id, `📊 Poll: ${question}`, {
      poll: pollData,
    });

    setShowPollModal(false);
    setPollQuestion("");
    setPollOptions([createPollOptionDraft(), createPollOptionDraft()]);
    setPollAllowMultiple(false);
    setPollFormError(null);
  }

  // --- Message Actions: Delete, Star, Copy, Forward ---
  function handleStartEditingMessage(message: Message) {
    if (!activeConv || message.senderId !== currentUser.id || message.isDeleted || message.status === "scheduled") {
      return;
    }
    isEditingMessageRef.current = true;
    setEditingMessageId(message.id);
    setInputText(message.text);
    setReplyingTo(null);
    setScheduledDateTime("");
    setActiveMenuMsgId(null);
  }

  function handleCancelEditingMessage() {
    isEditingMessageRef.current = false;
    setEditingMessageId(null);
    const savedDraft = draftsRef.current[activeConversationId] ?? "";
    inputTextRef.current = savedDraft;
    setInputTextState(savedDraft);
    setDismissedComposerLinkUrl(null);
  }

  function handleDeleteMessage(msg: Message, forEveryone: boolean, ghostUnsend?: boolean) {
    if (!activeConv) return;
    setDeleteConfirmMsg(null);
    setActiveMenuMsgId(null);

    if (forEveryone) {
      if (ghostUnsend) {
        // 1. Ghost Unsend: completely vanish message without leaving "This message was deleted"
        onUpdateMessages?.((prev) => {
          const list = prev[activeConv.id];
          if (!list) return prev;
          return {
            ...prev,
            [activeConv.id]: list.filter((m) => m.id !== msg.id),
          };
        });

        void fetch(
          `/api/conversations/${encodeURIComponent(activeConv.id)}/messages/${encodeURIComponent(msg.id)}`,
          { method: "DELETE" },
        ).then(async (response) => {
          if (response.ok) return;
          const result = await response.json() as { error?: { message?: string } };
          throw new Error(result.error?.message || "Could not delete this message.");
        }).catch((error: unknown) => {
          onUpdateMessages?.((prev) => {
            const list = prev[activeConv.id] ?? [];
            if (list.some((item) => item.id === msg.id)) return prev;
            return { ...prev, [activeConv.id]: [...list, msg] };
          });
          setCopiedToast(error instanceof Error ? error.message : "Could not delete this message.");
          setTimeout(() => setCopiedToast(null), 3000);
        });

        setCopiedToast("Message un-sent cleanly without trace 👻");
        setTimeout(() => setCopiedToast(null), 2500);
      } else {
        // 2. Standard delete with trace
        const updatedMessage: Message = {
          ...msg,
          isDeleted: true,
          text: "🚫 You deleted this message",
          attachments: undefined,
          voiceNote: undefined,
          poll: undefined,
        };
        onUpdateMessages?.((prev) => {
          const list = prev[activeConv.id];
          if (!list) return prev;
          return {
            ...prev,
            [activeConv.id]: list.map((m) => m.id === msg.id ? updatedMessage : m),
          };
        });
        void persistMessageUpdate(updatedMessage);

      }
    } else {
      onUpdateMessages?.((prev) => {
        const list = prev[activeConv.id];
        if (!list) return prev;
        return {
          ...prev,
          [activeConv.id]: list.map((m) =>
            m.id === msg.id
              ? {
                ...m,
                deletedForUserIds: [...(m.deletedForUserIds || []), currentUser.id],
              }
              : m
          ),
        };
      });
    }
  }

  async function handleCancelScheduledMessage(message: Message) {
    if (!activeConv) return;
    const conversationId = activeConv.id;
    setActiveMenuMsgId(null);
    try {
      const response = await fetch(
        `/api/conversations/${encodeURIComponent(conversationId)}/scheduled-messages/${encodeURIComponent(message.id)}`,
        { method: "DELETE" },
      );
      if (response.status === 409) {
        const historyResponse = await fetch(
          `/api/conversations/${encodeURIComponent(conversationId)}/messages`,
        );
        if (historyResponse.ok) {
          const historyResult = await historyResponse.json() as { messages?: Message[] };
          if (Array.isArray(historyResult.messages)) {
            onUpdateMessages?.((previous) => ({
              ...previous,
              [conversationId]: historyResult.messages ?? [],
            }));
          }
        }
        await refreshConversation(conversationId);
        throw new Error("This message has already been delivered.");
      }
      const result = await response.json() as { error?: { message?: string } };
      if (!response.ok) {
        throw new Error(result.error?.message || "Could not cancel this scheduled message.");
      }

      const remainingMessages = (messages[conversationId] ?? []).filter(
        (item) => item.id !== message.id
      );
      onUpdateMessages?.((previous) => ({
        ...previous,
        [conversationId]: (previous[conversationId] ?? []).filter((item) => item.id !== message.id),
      }));
      onUpdateConversations?.((previous) => previous.map((conversation) =>
        conversation.id === conversationId && conversation.lastMessage?.id === message.id
          ? { ...conversation, lastMessage: remainingMessages.at(-1) }
          : conversation
      ));
      setCopiedToast("Scheduled message cancelled.");
      setTimeout(() => setCopiedToast(null), 2500);
    } catch (error) {
      setCopiedToast(error instanceof Error ? error.message : "Could not cancel this scheduled message.");
      setTimeout(() => setCopiedToast(null), 3000);
    }
  }

  function handleToggleStar(msg: Message) {
    if (!activeConv) return;
    setActiveMenuMsgId(null);
    const updatedMessage = { ...msg, isStarred: !msg.isStarred };
    onUpdateMessages?.((prev) => {
      const list = prev[activeConv.id];
      if (!list) return prev;
      return {
        ...prev,
        [activeConv.id]: list.map((m) =>
          m.id === msg.id ? updatedMessage : m
        ),
      };
    });
    void persistMessageUpdate(updatedMessage);
    setCopiedToast(msg.isStarred ? "Message unstarred" : "Message starred ⭐");
    setTimeout(() => setCopiedToast(null), 2000);
  }

  async function handleTogglePin(msg: Message) {
    if (!activeConv) return;
    const conversationId = activeConv.id;
    setActiveMenuMsgId(null);
    try {
      const response = await fetch(
        `/api/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(msg.id)}/pin`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isPinned: !msg.isPinned }),
        }
      );
      if (!response.ok) {
        const result = await response.json() as { error?: { message?: string } };
        throw new Error(result.error?.message || "Could not update the pinned message.");
      }

      const result = await response.json() as { isPinned: boolean };
      onUpdateMessages?.((prev) => {
        const list = prev[conversationId];
        if (!list) return prev;
        return {
          ...prev,
          [conversationId]: list.map((message) => {
            if (message.id === msg.id) return { ...message, isPinned: result.isPinned };
            return result.isPinned && message.isPinned ? { ...message, isPinned: false } : message;
          }),
        };
      });
      realtime.send(
        "chat:pin",
        { messageId: msg.id, conversationId, isPinned: result.isPinned },
        conversationId,
      );
      setCopiedToast(result.isPinned ? "Message pinned" : "Message unpinned");
      setTimeout(() => setCopiedToast(null), 2000);
    } catch (error) {
      setCopiedToast(error instanceof Error ? error.message : "Could not update the pinned message.");
      setTimeout(() => setCopiedToast(null), 2500);
    }
  }

  function handleCopyMessageText(text: string) {
    setActiveMenuMsgId(null);
    navigator.clipboard.writeText(text).catch(() => { });
    setCopiedToast("Message text copied to clipboard!");
    setTimeout(() => setCopiedToast(null), 2500);
  }

  function closeForwardFlow() {
    setForwardModalMessages([]);
    setIsSelectingForwardMessages(false);
    setForwardRecipientIds([]);
    setForwardSearchQuery("");
    setForwardCaption("");
  }

  function openForwardModal(message: Message) {
    if (!canForwardMessage(message)) {
      setCopiedToast("Deleted, expired, or unsent messages cannot be forwarded.");
      setTimeout(() => setCopiedToast(null), 2500);
      return;
    }
    setForwardModalMessages([message]);
    setIsSelectingForwardMessages(false);
    setForwardRecipientIds([]);
    setForwardSearchQuery("");
    setForwardCaption("");
    setActiveMenuMsgId(null);
  }

  function toggleForwardMessageSelection(message: Message) {
    if (!canForwardMessage(message)) return;
    setForwardModalMessages((selected) =>
      selected.some((item) => item.id === message.id)
        ? selected.filter((item) => item.id !== message.id)
        : [...selected, message],
    );
  }

  function toggleForwardRecipient(conversationId: string) {
    setForwardRecipientIds((selected) =>
      selected.includes(conversationId)
        ? selected.filter((id) => id !== conversationId)
        : [...selected, conversationId],
    );
  }

  function handleForwardMessages() {
    if (forwardModalMessages.length === 0 || forwardRecipientIds.length === 0) return;
    const validMessages = forwardModalMessages.filter((message) => canForwardMessage(message));
    if (validMessages.length !== forwardModalMessages.length) {
      setForwardModalMessages(validMessages);
      setCopiedToast(
        validMessages.length > 0
          ? "Expired or deleted messages were removed. Review your selection."
          : "Deleted or expired messages cannot be forwarded.",
      );
      setTimeout(() => setCopiedToast(null), 3000);
      if (validMessages.length === 0) closeForwardFlow();
      return;
    }

    const targets = forwardRecipientIds
      .map((id) => conversations.find((conversation) => conversation.id === id))
      .filter((conversation): conversation is Conversation => Boolean(conversation));
    if (targets.length === 0) return;

    clearScheduleForImmediateSend();
    const caption = forwardCaption.trim();
    const captions = validMessages.map((message) =>
      [message.forwardingCaption?.trim(), caption].filter(Boolean).join("\n\n"),
    );
    if (captions.some((value) => value.length > 1000)) {
      setCopiedToast("The new caption and existing forwarded caption exceed the 1000-character limit.");
      setTimeout(() => setCopiedToast(null), 3000);
      return;
    }

    for (const target of targets) {
      for (const [index, message] of validMessages.entries()) {
        onSendMessage(target.id, message.text, {
          attachments: message.attachments,
          voiceNote: message.voiceNote,
          sharedContact: message.sharedContact,
          poll: message.poll,
          isForwarded: true,
          ...(captions[index] ? { forwardingCaption: captions[index] } : {}),
        });
      }
    }

    const messageCount = validMessages.length;
    const targetCount = targets.length;
    closeForwardFlow();
    setCopiedToast(
      `Forwarded ${messageCount} message${messageCount === 1 ? "" : "s"} to ${targetCount} chat${targetCount === 1 ? "" : "s"}.`,
    );
    setTimeout(() => setCopiedToast(null), 2500);
  }

  function handleReaction(msgId: string, emoji: string) {
    if (!activeConv) return;
    const message = (messages[activeConv.id] ?? []).find((item) => item.id === msgId);
    if (!message) return;
    setDismissedReactionToolbarMsgId(msgId);
    const isReacting = !(message.reactions?.[emoji] ?? []).includes(currentUser.id);
    const updatedMessage: Message = {
      ...message,
      reactions: updateMessageReaction(message.reactions, emoji, currentUser.id, isReacting),
    };
    onUpdateMessages?.((prev) => {
      const list = prev[activeConv.id];
      if (!list) return prev;
      return {
        ...prev,
        [activeConv.id]: list.map((item) => item.id === msgId ? updatedMessage : item),
      };
    });

    realtime.send(
      "chat:reaction",
      { messageId: msgId, conversationId: activeConv.id, emoji, isReacting },
      activeConv.id
    );
    soundFx.playReceived();
  }

  function handleClearChat() {
    if (!activeConv) return;
    if (confirm("Are you sure you want to clear all messages in this chat?")) {
      onUpdateMessages?.((prev) => ({
        ...prev,
        [activeConv.id]: [],
      }));
      setCopiedToast("Chat history cleared.");
      setTimeout(() => setCopiedToast(null), 2500);
    }
  }

  function handleToggleChatLock() {
    if (!activeConv || isUpdatingChatLock) return;
    if (!activeConv.isLocked && !hasAppPin) {
      setCopiedToast("Set a 4-digit App PIN before locking this conversation.");
      window.setTimeout(() => setCopiedToast(null), 3000);
      onRequestAppPin();
      return;
    }
    const nextIsLocked = !activeConv.isLocked;
    setIsUpdatingChatLock(true);
    void onSetConversationLock(activeConv.id, nextIsLocked)
      .catch((error: unknown) => {
        setCopiedToast(error instanceof Error ? error.message : "Could not update conversation lock.");
        window.setTimeout(() => setCopiedToast(null), 3000);
      })
      .finally(() => setIsUpdatingChatLock(false));
  }

  function handleSetDisappearingTimer(hours: number) {
    if (!activeConv || disappearingTimerPending) return;
    setDisappearingTimerPending(true);
    void onSetDisappearingTimer(activeConv.id, hours)
      .then(() => {
        setCopiedToast(hours === 0
          ? "Disappearing messages turned off."
          : `New messages will disappear after ${hours % 24 === 0 ? `${hours / 24} days` : `${hours} hours`}.`);
        window.setTimeout(() => setCopiedToast(null), 3000);
      })
      .catch((error: unknown) => {
        setCopiedToast(error instanceof Error ? error.message : "Could not update the disappearing-message timer.");
        window.setTimeout(() => setCopiedToast(null), 3000);
      })
      .finally(() => setDisappearingTimerPending(false));
  }

  function handleReadAloud(text: string) {
    if ("speechSynthesis" in window) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1.0;
      window.speechSynthesis.speak(utterance);
    }
  }

  function handleConvClick(conv: Conversation) {
    if (conv.isLocked && !unlockedChatIds.has(conv.id)) {
      setPendingLocalUnlockChatId(conv.id);
      onUnlockLockedChat(conv.id);
    } else {
      onSelectConversation(conv.id);
      setMobileChatOpen(true);
      onVisibleConversationChange?.(conv.id);
    }
  }

  useEffect(() => {
    if (!pendingLocalUnlockChatId || !unlockedChatIds.has(pendingLocalUnlockChatId)) return;
    onSelectConversation(pendingLocalUnlockChatId);
    setMobileChatOpen(true);
    onVisibleConversationChange?.(pendingLocalUnlockChatId);
    setPendingLocalUnlockChatId(null);
  }, [pendingLocalUnlockChatId, unlockedChatIds, onSelectConversation, onVisibleConversationChange]);

  // In-Chat Search Matches
  const searchMatches = inChatSearchQuery.trim()
    ? activeMessages.filter((m) =>
      m.text.toLowerCase().includes(inChatSearchQuery.toLowerCase())
    )
    : [];
  const safeSearchMatchIndex = searchMatches.length
    ? activeSearchMatchIndex % searchMatches.length
    : 0;
  const currentSearchMatchId = searchMatches.length
    ? searchMatches[safeSearchMatchIndex]?.id
    : undefined;

  function closeInChatSearch() {
    setShowInChatSearch(false);
    setInChatSearchQuery("");
    setActiveSearchMatchIndex(0);
  }

  function navigateSearchMatches(direction: -1 | 1) {
    if (searchMatches.length === 0) return;
    const nextIndex = (
      safeSearchMatchIndex + direction + searchMatches.length
    ) % searchMatches.length;
    const nextMessageId = searchMatches[nextIndex]?.id;
    setActiveSearchMatchIndex(nextIndex);
    if (!nextMessageId) return;

    window.requestAnimationFrame(() => {
      const messageRow = Array.from(
        messagesStreamRef.current?.querySelectorAll<HTMLElement>("[data-message-id]") ?? []
      ).find((element) => element.dataset.messageId === nextMessageId);
      messageRow?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }

  const isCurrentChatLocked = activeConv?.isLocked && !unlockedChatIds.has(activeConv.id);

  return (
    <div className={`chats-layout ${mobileChatOpen ? "mobile-in-chat" : "mobile-in-list"}`}>
      {/* Hidden File Inputs for real image & document uploads */}
      <input
        type="file"
        ref={imageInputRef}
        accept="image/*,video/*"
        style={{ display: "none" }}
        onChange={(e) => handleFileInputChange(e, "image")}
      />
      <input
        type="file"
        ref={fileInputRef}
        accept="*/*"
        style={{ display: "none" }}
        onChange={(e) => handleFileInputChange(e, "file")}
      />

      {/* Floating Toast Notification */}
      {copiedToast && (
        <div
          style={{
            position: "fixed",
            bottom: "85px",
            left: "50%",
            transform: "translateX(-50%)",
            background: "#202c33",
            color: "#00a884",
            padding: "8px 18px",
            borderRadius: "20px",
            boxShadow: "0 4px 16px rgba(0,0,0,0.6)",
            fontSize: "13px",
            fontWeight: 600,
            zIndex: 100,
            display: "flex",
            alignItems: "center",
            gap: "8px",
            border: "1px solid rgba(0, 168, 132, 0.4)",
          }}
        >
          <Check size={15} />
          <span>{copiedToast}</span>
        </div>
      )}
      {manualInviteUrl && (
        <InviteLinkManualCopy
          url={manualInviteUrl}
          onClose={() => setManualInviteUrl(null)}
        />
      )}

      {/* Sidebar: Conversation List */}
      <aside className="chats-sidebar">
        <div className="sidebar-header">
          <div className="sidebar-brand-title-row">
            <img src="/icon.svg" alt="" className="sidebar-brand-logo" />
            <span className="sidebar-brand-title">ConnectSphere</span>
          </div>

          <div className="sidebar-header-top">
            <h2 className="sidebar-title">Chats</h2>
            <button
              type="button"
              className="new-chat-icon-btn"
              onClick={() => setShowNewChatModal(true)}
              title="New Chat"
              aria-label="Start new chat"
            >
              <Plus size={18} strokeWidth={2.5} />
            </button>
          </div>

          <div className="search-bar">
            <Search size={15} className="search-icon" />
            <input
              type="text"
              className={searchQuery ? "has-search-clear" : undefined}
              placeholder="Search conversations..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              aria-label="Search conversations"
            />
            {searchQuery && (
              <button
                type="button"
                className="clear-search-btn"
                onClick={() => setSearchQuery("")}
              >
                <X size={14} />
              </button>
            )}
          </div>
        </div>

        {/* Conversation Items List */}
        <div className="conversations-list" role="list">
          {filteredConversations.length === 0 ? (
            <div className="empty-conversations-state">
              <div className="empty-conv-icon-circle">
                <Users size={28} />
              </div>
              <h3>No conversations yet</h3>
              <p>
                {searchQuery
                  ? "No matching conversations found."
                  : "Start chatting with registered members:"}
              </p>
              {registeredUsers.length > 0 && !searchQuery && (
                <div className="empty-sidebar-users-preview">
                  {registeredUsers.slice(0, 4).map((u) => (
                    <div
                      key={u.id}
                      className="empty-sidebar-user-row"
                      onClick={() => handleStartChatWithUser(u)}
                      role="button"
                      tabIndex={0}
                    >
                      <img
                        src={getSafeAvatar(u.avatar, u.displayName)}
                        alt={u.displayName}
                        className="empty-sidebar-user-avatar"
                      />
                      <div className="empty-sidebar-user-info">
                        <span className="empty-sidebar-user-name">{u.displayName}</span>
                        <span className="empty-sidebar-user-email">@{u.username || u.email?.split("@")[0]}</span>
                      </div>
                      <span className="empty-sidebar-chat-action">Chat</span>
                    </div>
                  ))}
                </div>
              )}
              <button
                type="button"
                className="wa-empty-action-btn"
                onClick={() => setShowNewChatModal(true)}
              >
                <Plus size={16} /> Start New Chat
              </button>
            </div>
          ) : (
            filteredConversations.map((conv) => {
              const isSelected = conv.id === activeConversationId;
              const convMsgs = messages[conv.id] ?? [];
              const lastMsg = convMsgs[convMsgs.length - 1];
              const isLockedRestricted = conv.isLocked && !unlockedChatIds.has(conv.id);
              const draftPreview = isLockedRestricted || !drafts[conv.id]?.trim()
                ? ""
                : drafts[conv.id] ?? "";
              const unreadCount = convMsgs.filter(
                (m) => m.senderId !== currentUser.id && m.status !== "read"
              ).length;

              return (
                <div
                  key={conv.id}
                  role="listitem"
                  tabIndex={0}
                  className={`conversation-item ${isSelected ? "is-selected" : ""} ${conv.isPinned ? "is-pinned" : ""}`}
                  onClick={() => handleConvClick(conv)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      handleConvClick(conv);
                    }
                  }}
                >
                  <div className="conv-avatar-wrapper">
                    <img src={getSafeAvatar(conv.avatar, conv.name)} alt={conv.name} className="conv-avatar-img" />
                    {conv.isOnline && <span className="online-badge-dot" />}
                    {conv.isLocked && (
                      <span className="locked-badge-icon" title="PIN Protected Chat">
                        <Lock size={10} />
                      </span>
                    )}
                  </div>

                  <div className="conv-content">
                    <div className="conv-header-row">
                      <span className="conv-name">{conv.name}</span>
                      <span
                        className="conv-timestamp"
                        title={lastMsg ? parseMessageDate(lastMsg.timestamp)?.toLocaleString() : undefined}
                      >
                        {formatConversationTime(lastMsg?.timestamp)}
                      </span>
                    </div>

                    <div className="conv-snippet-row">
                      <div className="conv-snippet-content">
                        {!draftPreview && lastMsg && lastMsg.senderId === currentUser.id && !isLockedRestricted && (
                          <span className={`conv-status-ticks ${lastMsg.status === "read" ? "is-read" : ""}`}>
                            {lastMsg.status === "read" || lastMsg.status === "delivered" ? (
                              <CheckCheck size={14} className={lastMsg.status === "read" ? "text-read-ticks" : "text-muted"} />
                            ) : (
                              <Check size={14} className="text-muted" />
                            )}
                          </span>
                        )}
                        <p className={`conv-snippet ${peerTyping[conv.id] ? "conv-snippet-typing" : ""}`}>
                          {isLockedRestricted
                            ? "🔒 Locked conversation (Enter PIN to view)"
                            : peerTyping[conv.id] || conv.isTyping
                              ? "typing..."
                              : draftPreview
                                ? <><span className="conv-draft-label">Draft</span> {draftPreview}</>
                                : getConversationSnippet(lastMsg, conv.description)}
                        </p>
                      </div>

                      <div className="conv-meta-badges">
                        {conv.isPinned && <Pin size={12} className="pinned-icon" />}
                        {unreadCount > 0 && (
                          <span className="unread-counter-badge">{unreadCount}</span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </aside>

      {/* Main Chat Area */}
      {activeConv ? (
        <main
          className={`chat-main-area wallpaper-${activeChatWallpaper}`}
          style={activeChatWallpaper === CUSTOM_CHAT_WALLPAPER_ID && customWallpaperUrl
            ? {
                backgroundImage: `linear-gradient(rgba(6, 9, 14, 0.2), rgba(6, 9, 14, 0.2)), url("${customWallpaperUrl}")`,
                backgroundPosition: "center",
                backgroundSize: "cover",
              }
            : undefined}
        >
          {/* Chat Room Top Bar */}
          <div className="chat-room-header">
            <div
              className="chat-target-info"
              onClick={() => setShowContactInfoDrawer((prev) => !prev)}
              style={{ cursor: "pointer" }}
              title="Click to view Contact Info"
            >
              <button
                type="button"
                className="mobile-back-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  setMobileChatOpen(false);
                  onVisibleConversationChange?.(null);
                }}
                aria-label="Back to conversations"
              >
                <ArrowLeft size={20} />
              </button>
              <div className="target-avatar-wrap">
                <img src={getSafeAvatar(activeConv.avatar, activeConv.name)} alt={activeConv.name} className="target-avatar" />
                {activeConv.isOnline && <span className="target-online-dot" />}
              </div>
              <div className="target-info-wrap">
                <div className="target-title-row">
                  <h2 className="target-name">{activeConv.name}</h2>
                  {activeConv.isLocked && (
                    <span className="locked-pill-tag">
                      <Lock size={12} /> PIN Locked
                    </span>
                  )}
                </div>
                <p className="target-status">
                  {activePeerTyping ? (
                    <span className="chat-typing-status">
                      {activePeerTyping.displayName ? `${activePeerTyping.displayName} is typing...` : "typing..."}
                    </span>
                  ) : activeConv.isTyping ? (
                    "typing..."
                  ) : activeConv.isOnline ? (
                    <span className="target-online-status">
                      Online
                    </span>
                  ) : (
                    formatLastSeen(activeConv.lastSeen, new Date(lastSeenClock))
                  )}
                </p>
              </div>
            </div>

            <div className="chat-room-actions">
              {/* Call Buttons */}
              <button
                type="button"
                className="chat-action-btn"
                onClick={() => onStartCall(activeConv.name, getSafeAvatar(activeConv.avatar, activeConv.name), false, activeConv.peerUserId, activeConv.peerPhone)}
                title="Voice Call"
              >
                <Phone size={18} />
              </button>
              <button
                type="button"
                className="chat-action-btn call-video-btn"
                onClick={() => onStartCall(activeConv.name, getSafeAvatar(activeConv.avatar, activeConv.name), true, activeConv.peerUserId, activeConv.peerPhone)}
                title="Video Call"
              >
                <Video size={18} />
              </button>

              {/* In-Chat Message Search */}
              <button
                type="button"
                className={`chat-action-btn ${showInChatSearch ? "text-accent" : ""}`}
                onClick={() => setShowInChatSearch((prev) => !prev)}
                title="Search in this chat"
              >
                <Search size={18} />
              </button>

              {/* Contact Info Drawer Toggle */}
              <button
                type="button"
                className="chat-action-btn"
                onClick={() => setShowContactInfoDrawer((prev) => !prev)}
                title="Contact Info & Settings"
              >
                <MoreVertical size={18} />
              </button>
            </div>
          </div>

          {/* In-Chat Search Bar Drawer */}
          {showInChatSearch && (
            <div className="in-chat-search-bar">
              <div className="in-chat-search-controls">
                <div className="in-chat-search-input-wrap">
                  <Search size={17} className="text-muted" aria-hidden="true" />
                  <input
                    type="search"
                    className="in-chat-search-input"
                    placeholder="Search messages in this chat"
                    value={inChatSearchQuery}
                    onChange={(event) => {
                      setInChatSearchQuery(event.target.value);
                      setActiveSearchMatchIndex(0);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") closeInChatSearch();
                      if (event.key === "Enter") {
                        event.preventDefault();
                        navigateSearchMatches(event.shiftKey ? -1 : 1);
                      }
                    }}
                    aria-label="Search messages in this chat"
                    autoFocus
                  />
                  {inChatSearchQuery.trim() && (
                    <span className={`in-chat-search-count ${searchMatches.length === 0 ? "is-empty" : ""}`}>
                      {searchMatches.length === 0
                        ? "No matches"
                        : `${safeSearchMatchIndex + 1} of ${searchMatches.length}`}
                    </span>
                  )}
                  {inChatSearchQuery.trim() && (
                    <button
                      type="button"
                      className="in-chat-search-clear"
                      onClick={() => {
                        setInChatSearchQuery("");
                        setActiveSearchMatchIndex(0);
                      }}
                      aria-label="Clear search text"
                      title="Clear search text"
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
                <div className="in-chat-search-actions">
                  <button
                    type="button"
                    className="in-chat-search-nav-btn"
                    onClick={() => navigateSearchMatches(-1)}
                    disabled={searchMatches.length === 0}
                    aria-label="Previous matching message"
                    title="Previous match"
                  >
                    <ChevronUp size={17} />
                  </button>
                  <button
                    type="button"
                    className="in-chat-search-nav-btn"
                    onClick={() => navigateSearchMatches(1)}
                    disabled={searchMatches.length === 0}
                    aria-label="Next matching message"
                    title="Next match"
                  >
                    <ChevronDown size={17} />
                  </button>
                  <button
                    type="button"
                    className="in-chat-search-btn"
                    onClick={closeInChatSearch}
                    aria-label="Close message search"
                    title="Close search"
                  >
                    <X size={17} />
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Locked chat warning overlay if locked */}
          {isCurrentChatLocked ? (
            <div className="chat-locked-pane">
              <Lock size={48} className="text-accent" />
              <h3>This Chat is PIN Protected</h3>
              <p>Security lock is active. Enter your 4-digit PIN to access message history and attachments.</p>
              <button
                type="button"
                className="primary-action-btn"
                onClick={() => {
                  setPendingLocalUnlockChatId(activeConv.id);
                  onUnlockLockedChat(activeConv.id);
                }}
              >
                Unlock Chat with PIN
              </button>
            </div>
          ) : (
            <div className="chat-content-layout">
              <div className="chat-conversation-pane">
                {/* Informational banners */}
                {!isOnline && (
                  <div className="offline-chat-banner" role="status">
                    <Clock size={16} />
                    <span>
                      <strong>You're offline.</strong> Messages will send when your connection returns.
                    </span>
                  </div>
                )}

                {activeConv.disappearingTimerHours && activeConv.disappearingTimerHours > 0 && (
                  <div className="disappearing-chat-banner">
                    <Clock size={14} />
                    <span>Disappearing messages enabled: Messages expire after {activeConv.disappearingTimerHours}h</span>
                  </div>
                )}

                {pinnedMessage && (
                  <button
                    type="button"
                    className="pinned-message-banner"
                    onClick={() => {
                      messagesStreamRef.current
                        ?.querySelector<HTMLElement>(`[data-message-id="${pinnedMessage.id}"]`)
                        ?.scrollIntoView({ behavior: "smooth", block: "center" });
                    }}
                    title="Jump to pinned message"
                  >
                    <Pin size={16} className="pinned-message-banner-icon" />
                    <span className="pinned-message-banner-copy">
                      <strong>Pinned message</strong>
                      <span>
                        {pinnedMessage.isDeleted
                          ? "Message deleted"
                          : pinnedMessage.text || (pinnedMessage.voiceNote ? "Voice message" : pinnedMessage.attachments?.[0]?.name || "Message")}
                      </span>
                    </span>
                  </button>
                )}

                {/* Message History Stream */}
                <div className="messages-stream" ref={messagesStreamRef}>
                  {/* Conversation access notice */}
                  <div className="wa-encryption-banner">
                    <Lock size={13} />
                    <span>Messages and files in this conversation are shared with its members.</span>
                  </div>

                  {isSelectingForwardMessages && (
                    <div className="forward-selection-toolbar" role="status">
                      <span>{forwardModalMessages.length} message{forwardModalMessages.length === 1 ? "" : "s"} selected</span>
                      <button type="button" className="secondary-btn" onClick={closeForwardFlow}>Cancel</button>
                      <button
                        type="button"
                        className="enhanced-start-btn"
                        disabled={forwardModalMessages.length === 0}
                        onClick={() => setIsSelectingForwardMessages(false)}
                      >
                        Continue
                      </button>
                    </div>
                  )}

                  {activeMessages.map((msg, index) => {
                    const isMe = msg.senderId === currentUser.id;
                    const messageDate = parseMessageDate(msg.timestamp);
                    const previousDate = index > 0
                      ? parseMessageDate(activeMessages[index - 1]!.timestamp)
                      : null;
                    const showDateDivider = messageDate !== null && (
                      index === 0 ||
                      previousDate === null ||
                      messageDate.toDateString() !== previousDate.toDateString()
                    );
                    const isSearchMatched =
                      inChatSearchQuery.trim() &&
                      msg.text.toLowerCase().includes(inChatSearchQuery.toLowerCase());

                    const prevMsg = index > 0 ? activeMessages[index - 1] : null;
                    const nextMsg = index < activeMessages.length - 1 ? activeMessages[index + 1] : null;
                    const isFirstInGroup = !prevMsg || prevMsg.senderId !== msg.senderId || showDateDivider;
                    const isLastInGroup = !nextMsg || nextMsg.senderId !== msg.senderId;
                    const isForwardSelected = forwardModalMessages.some((message) => message.id === msg.id);
                    const pollVoterCount = msg.poll
                      ? new Set(msg.poll.options.flatMap((option) => option.votes)).size
                      : 0;
                    const sharedContactPhoneLink = msg.sharedContact?.phone?.replace(/[^\d+]/g, "");
                    const sharedContactEmailLink = msg.sharedContact?.email
                      ? getContactMailtoHref(msg.sharedContact.email)
                      : null;

                    const hasMediaAttachment = !msg.isDeleted && Boolean(msg.attachments?.some((a) => a.type === "image" || a.type === "video"));
                    const messageLinkPreviews =
                      !msg.isDeleted &&
                      !msg.linkPreviewDisabled &&
                      !msg.poll &&
                      !msg.voiceNote &&
                      !msg.sharedContact &&
                      !msg.attachments?.length
                        ? getLinkPreviews(msg.text)
                        : [];

                    return (
                      <Fragment key={msg.id}>
                        {showDateDivider && messageDate && (
                          <div className="wa-date-divider">{formatMessageDateLabel(messageDate)}</div>
                        )}
                        <div
                          data-message-id={msg.id}
                          className={`message-bubble-row ${isMe ? "is-mine" : "is-theirs"} ${isFirstInGroup ? "is-group-start" : ""} ${isLastInGroup ? "is-group-end" : ""} ${activeMenuMsgId === msg.id ? "has-open-menu" : ""} ${currentSearchMatchId === msg.id ? "is-current-search-match" : ""} ${isForwardSelected ? "is-forward-selected" : ""}`}
                          onMouseLeave={() => setDismissedReactionToolbarMsgId((current) =>
                            current === msg.id ? null : current
                          )}
                          onFocusCapture={() => setDismissedReactionToolbarMsgId((current) =>
                            current === msg.id ? null : current
                          )}
                        >
                          {isSelectingForwardMessages && (
                            <button
                              type="button"
                              className="forward-message-select"
                              aria-label={`${isForwardSelected ? "Remove" : "Select"} message for forwarding`}
                              aria-pressed={isForwardSelected}
                              disabled={!canForwardMessage(msg)}
                              onClick={() => toggleForwardMessageSelection(msg)}
                            >
                              {isForwardSelected ? <Check size={15} /> : <Plus size={15} />}
                            </button>
                          )}
                          {!isMe && (
                            isFirstInGroup ? (
                              <img
                                src={getSafeAvatar(msg.senderAvatar || activeConv.avatar, msg.senderName || activeConv.name)}
                                alt={msg.senderName || activeConv.name}
                                className="msg-sender-avatar"
                              />
                            ) : (
                              <div className="msg-sender-avatar-spacer" aria-hidden="true" />
                            )
                          )}

                          <div className={`message-bubble ${isSearchMatched ? "msg-highlight-box" : ""} ${msg.poll ? "has-poll" : ""} ${msg.status === "scheduled" ? "is-scheduled" : ""} ${!msg.isDeleted && Object.values(msg.reactions ?? {}).some((userIds) => userIds.length > 0) ? "has-reactions" : ""} ${!msg.isDeleted && !msg.attachments?.length && isEmojiOnlyMessage(msg.text) ? "is-emoji-only" : ""} ${msg.voiceNote ? "has-voice-note" : ""} ${hasMediaAttachment ? "has-media-attachment" : ""}`}>
                            {/* Hover Chevron for Context Menu */}
                            {!msg.isDeleted && (
                              <button
                                type="button"
                                className="msg-dropdown-trigger"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setActiveMenuMsgId(activeMenuMsgId === msg.id ? null : msg.id);
                                }}
                                aria-label="Message options"
                              >
                                <ChevronDown size={14} />
                              </button>
                            )}

                            {msg.isForwarded && !msg.isDeleted && (
                              <div className="msg-forwarded-label">
                                <Forward size={12} />
                                <span>Forwarded</span>
                              </div>
                            )}
                            {msg.isForwarded && msg.forwardingCaption && !msg.isDeleted && (
                              <p className="msg-forwarding-caption">{msg.forwardingCaption}</p>
                            )}

                            {/* Message Context Dropdown Menu */}
                            {activeMenuMsgId === msg.id && (
                              <div className={`msg-context-menu ${isMe ? "is-mine" : "is-theirs"}`} onClick={(e) => e.stopPropagation()}>
                                {msg.status === "scheduled" ? (
                                  <button
                                    type="button"
                                    className="msg-context-item is-danger"
                                    onClick={() => void handleCancelScheduledMessage(msg)}
                                  >
                                    <X size={14} />
                                    <span>Cancel scheduled delivery</span>
                                  </button>
                                ) : (
                                  <>
                                {isMe && !msg.isDeleted && msg.text.trim().length > 0 && (
                                  <button
                                    type="button"
                                    className="msg-context-item"
                                    onClick={() => handleStartEditingMessage(msg)}
                                  >
                                    <Pencil size={14} />
                                    <span>Edit message</span>
                                  </button>
                                )}
                                <button
                                  type="button"
                                  className="msg-context-item"
                                  onClick={() => {
                                    setReplyingTo(msg);
                                    setActiveMenuMsgId(null);
                                  }}
                                >
                                  <CornerUpLeft size={14} />
                                  <span>Reply</span>
                                </button>
                                <button
                                  type="button"
                                  className="msg-context-item"
                                  onClick={() => handleToggleStar(msg)}
                                >
                                  <Star size={14} />
                                  <span>{msg.isStarred ? "Unstar" : "Star message"}</span>
                                </button>
                                <button
                                  type="button"
                                  className="msg-context-item"
                                  onClick={() => void handleTogglePin(msg)}
                                >
                                  <Pin size={14} />
                                  <span>{msg.isPinned ? "Unpin message" : "Pin message"}</span>
                                </button>
                                <button
                                  type="button"
                                  className="msg-context-item"
                                  onClick={() => handleCopyMessageText(msg.text || msg.sharedContact?.name || "")}
                                >
                                  <Copy size={14} />
                                  <span>{msg.sharedContact && !msg.text.trim() ? "Copy contact name" : "Copy text"}</span>
                                </button>
                                {canForwardMessage(msg) && (
                                  <button
                                    type="button"
                                    className="msg-context-item"
                                    onClick={() => openForwardModal(msg)}
                                  >
                                    <Forward size={14} />
                                    <span>Forward</span>
                                  </button>
                                )}
                                <button
                                  type="button"
                                  className="msg-context-item"
                                  onClick={() => {
                                    setInfoModalMsg(msg);
                                    setActiveMenuMsgId(null);
                                  }}
                                >
                                  <Info size={14} />
                                  <span>Message info</span>
                                </button>
                                <button
                                  type="button"
                                  className="msg-context-item is-danger"
                                  onClick={() => {
                                    setDeleteConfirmMsg(msg);
                                    setActiveMenuMsgId(null);
                                  }}
                                >
                                  <Trash2 size={14} />
                                  <span>Delete message</span>
                                </button>
                                  </>
                                )}
                              </div>
                            )}

                            {!isMe && activeConv.type !== "direct" && isFirstInGroup && (
                              <div className="msg-sender-name">{msg.senderName}</div>
                            )}

                            {/* Reply-to preview snippet */}
                            {msg.replyTo && (
                              <div className="msg-reply-quote">
                                <span className="quote-author">{msg.replyTo.senderName}</span>
                                <p className="quote-text">{msg.replyTo.text}</p>
                              </div>
                            )}

                            {msg.status === "scheduled" && (
                              <div className="scheduled-message-badge">
                                <Calendar size={13} aria-hidden="true" />
                                <span>Scheduled for</span>
                                <strong>{formatScheduledDateTime(msg.scheduledFor ?? "")}</strong>
                              </div>
                            )}

                            {/* Deleted Message Notice */}
                            {msg.isDeleted ? (
                              <p className="msg-deleted-text">
                                <Trash2 size={13} />
                                <span>{isMe ? "You deleted this message" : "This message was deleted"}</span>
                              </p>
                            ) : (
                              <>
                                {/* Voice Note player */}
                                {msg.voiceNote && (
                                  <AudioPlayer
                                    waveform={msg.voiceNote.waveform}
                                    durationSec={msg.voiceNote.durationSec}
                                    {...(msg.voiceNote.audioUrl ? { audioUrl: msg.voiceNote.audioUrl } : {})}
                                  />
                                )}

                                {/* Interactive WhatsApp Poll Card */}
                                {msg.poll && (
                                  <div className="wa-poll-card" role="group" aria-label={`Poll: ${msg.poll.question}`}>
                                    <div className="wa-poll-heading">
                                      <div className="wa-poll-icon"><BarChart2 size={17} /></div>
                                      <div className="wa-poll-heading-copy">
                                        <span className="wa-poll-eyebrow">POLL</span>
                                        <h3 className="wa-poll-title">{msg.poll.question}</h3>
                                      </div>
                                    </div>
                                    <div className="wa-poll-type-badge">
                                      {msg.poll.multipleAnswers ? "Choose all that apply" : "Choose one option"}
                                    </div>
                                    <div className="wa-poll-options">
                                      {msg.poll.options.map((opt) => {
                                        const pct = pollVoterCount > 0
                                          ? Math.round((opt.votes.length / pollVoterCount) * 100)
                                          : 0;
                                        const isVoted = opt.votes.includes(currentUser.id);

                                        return (
                                          <button
                                            key={opt.id}
                                            type="button"
                                            className={`wa-poll-option-btn ${isVoted ? "is-voted" : ""} ${pendingPollVoteId === msg.id ? "is-pending" : ""}`}
                                            onClick={() => void handleVotePoll(msg.id, opt.id)}
                                            disabled={pendingPollVoteId !== null}
                                            aria-pressed={isVoted}
                                            aria-label={`${opt.text}, ${opt.votes.length} ${opt.votes.length === 1 ? "vote" : "votes"}, ${pct}%`}
                                          >
                                            <span className="wa-poll-fill-bar" style={{ width: `${pct}%` }} />
                                            <span className={`wa-poll-choice-indicator ${msg.poll.multipleAnswers ? "is-multiple" : ""} ${isVoted ? "is-selected" : ""}`}>
                                              {isVoted && <Check size={11} strokeWidth={3} />}
                                            </span>
                                            <span className="wa-poll-option-text">{opt.text}</span>
                                            <span className="wa-poll-option-result">
                                              <strong>{pct}%</strong>
                                              <span>{opt.votes.length}</span>
                                            </span>
                                          </button>
                                        );
                                      })}
                                    </div>
                                    <div className="wa-poll-footer">
                                      <span>{pollVoterCount} {pollVoterCount === 1 ? "vote" : "votes"}</span>
                                      <span>
                                        {pendingPollVoteId === msg.id
                                          ? "Saving vote…"
                                          : pollVoterCount > 0 ? "Tap an option to change your vote" : "Be the first to vote"}
                                      </span>
                                    </div>
                                  </div>
                                )}

                                {msg.sharedContact && (
                                  <div
                                    className="msg-contact-card"
                                    role="group"
                                    aria-label={`Shared contact: ${msg.sharedContact.name}`}
                                    style={{
                                      width: "min(280px, 70vw)",
                                      maxWidth: 300,
                                      margin: "8px 0",
                                      padding: 14,
                                      borderRadius: 12,
                                      background: "rgba(0, 0, 0, 0.14)",
                                      border: "1px solid rgba(255, 255, 255, 0.12)",
                                    }}
                                  >
                                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                                      <div
                                        aria-hidden="true"
                                        style={{
                                          width: 38,
                                          height: 38,
                                          borderRadius: "50%",
                                          display: "grid",
                                          placeItems: "center",
                                          background: "rgba(0, 168, 132, 0.16)",
                                          color: "#00a884",
                                        }}
                                      >
                                        <UserIcon size={19} />
                                      </div>
                                      <div style={{ minWidth: 0 }}>
                                        <strong style={{ display: "block", overflowWrap: "anywhere" }}>
                                          {msg.sharedContact.name}
                                        </strong>
                                        <span style={{ fontSize: 11, opacity: 0.72 }}>Contact card</span>
                                      </div>
                                    </div>
                                    {msg.sharedContact.phone && (
                                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 7 }}>
                                        <Phone size={14} aria-hidden="true" />
                                        {sharedContactPhoneLink && (
                                          <a href={`tel:${sharedContactPhoneLink}`} style={{ flex: 1 }}>
                                            {msg.sharedContact.phone}
                                          </a>
                                        )}
                                        <button
                                          type="button"
                                          className="chat-action-btn"
                                          style={{ width: 28, height: 28 }}
                                          aria-label={`Copy ${msg.sharedContact.name}'s phone number`}
                                          onClick={() => {
                                            const phone = msg.sharedContact?.phone;
                                            if (phone) void handleCopyContactValue(phone);
                                          }}
                                        >
                                          <Copy size={13} />
                                        </button>
                                      </div>
                                    )}
                                    {msg.sharedContact.email && (
                                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 7 }}>
                                        <Mail size={14} aria-hidden="true" />
                                        {sharedContactEmailLink ? (
                                          <a href={sharedContactEmailLink} style={{ flex: 1, overflowWrap: "anywhere" }}>
                                            {msg.sharedContact.email}
                                          </a>
                                        ) : (
                                          <span style={{ flex: 1, overflowWrap: "anywhere" }}>
                                            {msg.sharedContact.email}
                                          </span>
                                        )}
                                        <button
                                          type="button"
                                          className="chat-action-btn"
                                          style={{ width: 28, height: 28 }}
                                          aria-label={`Copy ${msg.sharedContact.name}'s email address`}
                                          onClick={() => {
                                            const email = msg.sharedContact?.email;
                                            if (email) void handleCopyContactValue(email);
                                          }}
                                        >
                                          <Copy size={13} />
                                        </button>
                                      </div>
                                    )}
                                    <button
                                      type="button"
                                      className="secondary-btn"
                                      style={{ width: "100%", marginTop: 12 }}
                                      onClick={() => {
                                        const contact = msg.sharedContact;
                                        if (contact) handleDownloadContactVCard(contact);
                                      }}
                                    >
                                      Save contact
                                    </button>
                                  </div>
                                )}

                                {/* Real Image & Video attachments with Lightbox & Details Bar */}
                                {msg.attachments?.map((att) => (
                                  <div key={att.id} className="msg-attachment-item">
                                    {att.type === "video" ? (
                                      <div className="msg-media-card">
                                        <video
                                          src={att.url}
                                          controls
                                          className="msg-attached-video"
                                          aria-label={att.name}
                                          preload="metadata"
                                        />
                                        <div className="msg-media-info-bar">
                                          <div className="media-info-left" title={att.name}>
                                            <Video size={14} className="media-type-icon text-accent" />
                                            <span className="media-file-name">{att.name}</span>
                                            {att.size && <span className="media-file-size">{att.size}</span>}
                                          </div>
                                          <a
                                            href={att.url}
                                            download={att.name}
                                            className="media-download-btn"
                                            title={`Download ${att.name}`}
                                            target="_blank"
                                            rel="noreferrer"
                                          >
                                            <Download size={13} />
                                          </a>
                                        </div>
                                      </div>
                                    ) : att.type === "image" ? (
                                      <div className="msg-media-card">
                                        <div
                                          className="msg-media-preview-wrap"
                                          onClick={() => setLightboxUrl(att.url)}
                                          title={`Click to expand ${att.name}`}
                                        >
                                          <img
                                            src={att.url}
                                            alt={att.name}
                                            className="msg-attached-img"
                                            loading="lazy"
                                          />
                                          <div className="msg-media-overlay-badge" title="Expand image">
                                            <Maximize2 size={13} />
                                          </div>
                                        </div>
                                        <div className="msg-media-info-bar">
                                          <div className="media-info-left" title={att.name}>
                                            <ImageIcon size={14} className="media-type-icon text-accent" />
                                            <span className="media-file-name">{att.name}</span>
                                            {att.size && <span className="media-file-size">{att.size}</span>}
                                          </div>
                                          <a
                                            href={att.url}
                                            download={att.name}
                                            className="media-download-btn"
                                            title={`Download ${att.name}`}
                                            target="_blank"
                                            rel="noreferrer"
                                          >
                                            <Download size={13} />
                                          </a>
                                        </div>
                                      </div>
                                    ) : (
                                      <div className="msg-attached-file">
                                        <FileText size={22} className="text-accent" />
                                        <div className="file-info" style={{ flex: 1, minWidth: 0 }}>
                                          <span className="file-name" title={att.name}>{att.name}</span>
                                          <span className="file-size">{att.size}</span>
                                        </div>
                                        <a
                                          href={att.url}
                                          download={att.name}
                                          className="chat-action-btn"
                                          style={{ width: 28, height: 28 }}
                                          title={`Download ${att.name}`}
                                          target="_blank"
                                          rel="noreferrer"
                                        >
                                          <Download size={14} />
                                        </a>
                                      </div>
                                    )}
                                  </div>
                                ))}

                                {messageLinkPreviews.map((preview) => (
                                  <LinkPreviewCard
                                    key={preview.url}
                                    preview={preview}
                                    className="message-link-preview"
                                  />
                                ))}

                                {/* Message text / caption content (hide if duplicate of filename or default 'Photo' / 'Document') */}
                                {msg.text &&
                                  !msg.poll &&
                                  (!msg.voiceNote || msg.text !== "Voice note") &&
                                  (!msg.attachments?.length ||
                                    (msg.attachments.every((a) => a.name !== msg.text) &&
                                      msg.text !== "Photo" &&
                                      msg.text !== "Document")) && (
                                    <p className="msg-text-body msg-caption-text">
                                      {isSearchMatched ? (
                                        <span className="msg-highlight">{msg.text}</span>
                                      ) : (
                                        renderMessageLinks(msg.text)
                                      )}
                                    </p>
                                )}
                              </>
                            )}

                            {/* Timestamp, Star & Status indicators */}
                            <div className="msg-footer">
                              {msg.isStarred && (
                                <Star size={11} className="msg-starred-icon" fill="#ffd279" />
                              )}
                              {msg.isPinned && (
                                <Pin size={11} className="msg-pinned-icon" />
                              )}
                              <span
                                className="msg-timestamp"
                                title={messageDate?.toLocaleString()}
                              >
                                {formatMessageTime(msg.timestamp)}
                              </span>
                              {msg.isEdited && <span className="msg-edited-label">Edited</span>}
                              {isMe && !msg.isDeleted && (
                                <button
                                  type="button"
                                  className={`msg-status-icon ${msg.status === "read" ? "is-read" : ""} ${msg.status === "scheduled" ? "is-scheduled" : ""}`}
                                  title={
                                    msg.status === "failed"
                                      ? "Message failed. Click to retry."
                                      : msg.status === "scheduled"
                                        ? "Scheduled for automatic delivery"
                                        : `Status: ${msg.status}`
                                  }
                                  onClick={() => msg.status === "failed" && onRetryMessage?.(msg)}
                                >
                                  {msg.status === "scheduled" && <Calendar size={12} />}
                                  {msg.status === "pending" && <Clock size={12} className="spin-icon" />}
                                  {msg.status === "sent" && <Check size={12} />}
                                  {msg.status === "delivered" && <CheckCheck size={13} className="text-muted" />}
                                  {msg.status === "read" && <CheckCheck size={13} className="text-read-ticks" />}
                                  {msg.status === "failed" && <AlertCircle size={13} className="text-danger" />}
                                </button>
                              )}
                            </div>

                            {/* Emoji Reactions Bar */}
                            {!msg.isDeleted && msg.reactions && Object.values(msg.reactions).some((u) => u && u.length > 0) && (
                              <div className="reactions-pill-bar">
                                {Object.entries(msg.reactions)
                                  .filter(([, userIds]) => userIds && userIds.length > 0)
                                  .map(([emoji, userIds]) => (
                                    <button
                                      key={emoji}
                                      type="button"
                                      className={`reaction-tag ${userIds.includes(currentUser.id) ? "is-mine" : ""}`}
                                      onClick={() => handleReaction(msg.id, emoji)}
                                      aria-label={`${emoji}, ${userIds.length} ${userIds.length === 1 ? "reaction" : "reactions"}`}
                                      aria-pressed={userIds.includes(currentUser.id)}
                                    >
                                      <span>{emoji}</span>
                                      {userIds.length > 1 && <span className="react-count">{userIds.length}</span>}
                                    </button>
                                  ))}
                              </div>
                            )}

                            {/* Hover Quick Action Toolbar */}
                            {!msg.isDeleted && dismissedReactionToolbarMsgId !== msg.id && (
                              <div className="msg-hover-actions">
                                {["👍", "❤️", "😂", "😮", "😢", "🙏"].map((emoji) => (
                                  <button
                                    key={emoji}
                                    type="button"
                                    className="quick-react-btn"
                                    onClick={() => handleReaction(msg.id, emoji)}
                                    title={`React with ${emoji}`}
                                  >
                                    {emoji}
                                  </button>
                                ))}
                                <button
                                  type="button"
                                  className="msg-action-btn"
                                  onClick={() => setReplyingTo(msg)}
                                  title="Reply to message"
                                >
                                  <CornerUpLeft size={13} />
                                </button>
                                <button
                                  type="button"
                                  className="msg-action-btn"
                                  onClick={() => handleReadAloud(msg.text)}
                                  title="Read aloud (Text-to-Speech)"
                                >
                                  <Volume2 size={13} />
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      </Fragment>
                    );
                  })}
                  {activePeerTyping && (
                    <div className="typing-bubble-wrapper" role="status" aria-label={`${activePeerTyping.displayName || "Contact"} is typing`}>
                      <span className="typing-bubble-dots" aria-hidden="true"><i /><i /><i /></span>
                      <span className="typing-bubble-text">{activePeerTyping.displayName ? `${activePeerTyping.displayName} is typing...` : "typing..."}</span>
                    </div>
                  )}
                  <div ref={messagesEndRef} />
                </div>

                {/* Reply Quote bar */}
                {editingMessageId && (
                  <div className="replying-bar editing-message-bar" role="status">
                    <div className="replying-content">
                      <span className="replying-label">Editing message</span>
                      <p className="replying-snippet">Your changes will be visible to everyone in this chat.</p>
                    </div>
                    <button
                      type="button"
                      className="replying-close"
                      onClick={handleCancelEditingMessage}
                      disabled={isSavingEdit}
                      aria-label="Cancel editing message"
                    >
                      <X size={15} />
                    </button>
                  </div>
                )}
                {replyingTo && (
                  <div className="replying-bar">
                    <div className="replying-content">
                      <span className="replying-label">Replying to {replyingTo.senderName}:</span>
                      <p className="replying-snippet">{replyingTo.text}</p>
                    </div>
                    <button
                      type="button"
                      className="replying-close"
                      onClick={() => setReplyingTo(null)}
                    >
                      <X size={15} />
                    </button>
                  </div>
                )}

                {scheduledDateTime && (
                  <div className="scheduled-composer-banner" role="status">
                    <Calendar size={16} aria-hidden="true" />
                    <div className="scheduled-composer-copy">
                      <strong>Scheduled delivery</strong>
                      <span>{formatScheduledDateTime(new Date(scheduledDateTime).toISOString())}</span>
                    </div>
                    <button
                      type="button"
                      className="scheduled-composer-change"
                      onClick={() => {
                        setScheduleFormError(null);
                        setShowScheduleModal(true);
                      }}
                    >
                      Change
                    </button>
                    <button
                      type="button"
                      className="scheduled-composer-clear"
                      onClick={() => {
                        setScheduledDateTime("");
                        setScheduleFormError(null);
                      }}
                      aria-label="Clear scheduled delivery time"
                      title="Clear schedule"
                    >
                      <X size={15} />
                    </button>
                  </div>
                )}

                {/* WhatsApp Interactive Emoji Picker Tray */}
                {showEmojiPicker && (
                  <div className="wa-emoji-picker-dock">
                    <div className="wa-emoji-tabs">
                      {Object.entries(EMOJI_CATEGORIES).map(([catKey, cat]) => (
                        <button
                          key={catKey}
                          type="button"
                          className={`wa-emoji-tab-btn ${activeEmojiTab === catKey ? "is-active" : ""}`}
                          onClick={() => setActiveEmojiTab(catKey)}
                          title={cat.label}
                        >
                          {cat.icon}
                        </button>
                      ))}
                    </div>
                    <div className="wa-emoji-grid">
                      {EMOJI_CATEGORIES[activeEmojiTab]?.items.map((emoji, idx) => (
                        <button
                          key={idx}
                          type="button"
                          className="wa-emoji-item-btn"
                          onClick={() => {
                            setInputText((prev) => prev + emoji);
                          }}
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Voice Note Recording Overlay */}
                {isRecordingVoice ? (
                  <div className="voice-recording-dock">
                    <div className="recording-wave-visualizer">
                      <span className="recording-pulse-dot" />
                      <span className="recording-timer">0:{recordingSeconds < 10 ? "0" : ""}{recordingSeconds}</span>
                      <span className="recording-hint">Recording audio note...</span>
                    </div>
                    <div className="voice-actions">
                      <button
                        type="button"
                        className="cancel-record-btn"
                        onClick={handleCancelRecordingVoice}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        className="primary-action-btn voice-send-btn"
                        onClick={handleFinishVoiceNote}
                      >
                        <Send size={15} /> Send
                      </button>
                    </div>
                  </div>
                ) : (
                  /* Standard WhatsApp Message Input Bar */
                  <>
                    {composerLinkPreviews.map((preview) => (
                      <LinkPreviewCard
                        key={preview.url}
                        preview={preview}
                        className="composer-link-preview"
                        onDismiss={() => setDismissedComposerLinkUrl(preview.url)}
                      />
                    ))}
                    {(draftSaveError || (inputText.length > 0 && !editingMessageId)) && (
                      <div className="composer-draft-status">
                        <span role={draftSaveError ? "alert" : undefined}>
                          {draftSaveError ?? "Draft saved on this device"}
                        </span>
                        {draftSaveError ? (
                          <button
                            type="button"
                            onClick={() => saveDraftForConversation(activeConversationId, inputTextRef.current)}
                          >
                            Retry
                          </button>
                        ) : (
                          <button type="button" onClick={() => setInputText("")}>
                            Discard draft
                          </button>
                        )}
                      </div>
                    )}
                  <div className="chat-input-bar">
                    {/* 1. Emoji Picker Trigger */}
                    <button
                      type="button"
                      className={`chat-tool-btn ${showEmojiPicker ? "text-accent is-active" : ""}`}
                      onClick={() => setShowEmojiPicker((prev) => !prev)}
                      title="Emojis and Stickers"
                      aria-label="Toggle emoji picker"
                    >
                      <Smile size={20} />
                    </button>

                    {/* 2. Attachment Dropdown */}
                    <div className="attach-btn-wrap">
                      <button
                        type="button"
                        className={`chat-tool-btn ${showAttachMenu ? "text-accent is-active" : ""}`}
                        onClick={() => setShowAttachMenu((prev) => !prev)}
                        title="Attach files, media or create poll"
                        aria-label="Attach file"
                      >
                        <Paperclip size={20} />
                      </button>
                      {showAttachMenu && (
                        <div className="attach-dropdown-menu">
                          <button
                            type="button"
                            className="attach-menu-item"
                            onClick={handleTriggerPhotoUpload}
                          >
                            <ImageIcon size={16} className="text-accent" />
                            <span>Photos &amp; Videos</span>
                          </button>
                          <button
                            type="button"
                            className="attach-menu-item"
                            onClick={handleTriggerDocumentUpload}
                          >
                            <FileText size={16} className="text-warning" />
                            <span>Document</span>
                          </button>
                          <button
                            type="button"
                            className="attach-menu-item"
                            onClick={handleOpenContactShareModal}
                          >
                            <UserIcon size={16} className="text-accent" />
                            <span>Share contact</span>
                          </button>
                          <button
                            type="button"
                            className="attach-menu-item"
                            onClick={() => {
                              setShowAttachMenu(false);
                              clearScheduleForImmediateSend();
                              setShowPollModal(true);
                            }}
                          >
                            <BarChart2 size={16} style={{ color: "#f59e0b" }} />
                            <span>Create Poll</span>
                          </button>
                          <button
                            type="button"
                            className="attach-menu-item"
                            onClick={() => {
                              setShowAttachMenu(false);
                              setScheduleFormError(null);
                              setShowScheduleModal(true);
                            }}
                          >
                            <Calendar size={16} className="text-accent" />
                            <span>Schedule Delivery</span>
                          </button>
                        </div>
                      )}
                    </div>

                    {/* 3. Text Input (Expands horizontally to fill space) */}
                    <div className="chat-input-wrapper">
                      <textarea
                        className={`chat-text-input ${composerLinks[0] && /^https?:\/\/\S+$/i.test(inputText.trim()) ? "is-link" : ""}`}
                        rows={1}
                        placeholder="Type a message..."
                        inputMode="text"
                        enterKeyHint="send"
                        value={inputText}
                        onChange={(e) => {
                          const val = e.target.value;
                          if (!getLinkPreviews(val).some((link) => link.url === dismissedComposerLinkUrl)) {
                            setDismissedComposerLinkUrl(null);
                          }
                          setInputText(val);
                          e.target.style.height = "auto";
                          e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px";
                          if (activeConv) {
                            const isTyping = val.trim().length > 0;
                            realtime.sendTyping(activeConv.id, isTyping);
                            if (typingDebounceRef.current !== null) window.clearTimeout(typingDebounceRef.current);
                            if (isTyping) {
                              typingDebounceRef.current = window.setTimeout(() => {
                                realtime.sendTyping(activeConv.id, false);
                                typingDebounceRef.current = null;
                              }, 2_000);
                            } else {
                              typingDebounceRef.current = null;
                            }
                          }
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            handleSend();
                            e.currentTarget.style.height = "auto";
                          }
                        }}
                      />
                    </div>

                    {/* 4. Microphone Button for Voice Notes */}
                    <button
                      type="button"
                      className="chat-tool-btn mic-btn"
                      onClick={handleStartRecordingVoice}
                      title="Record Voice Note"
                      aria-label="Record Voice Note"
                    >
                      <Mic size={20} />
                    </button>

                    {/* 5. Send Message Button */}
                    <button
                      type="button"
                      className={`chat-send-btn ${inputText.trim() ? "is-active" : "is-idle"}`}
                      onClick={handleSend}
                      disabled={!inputText.trim() || isSchedulingMessage || isSavingEdit}
                      title={editingMessageId ? "Save edited message" : scheduledDateTime ? "Schedule message" : "Send message (Enter)"}
                      aria-label={editingMessageId ? "Save edited message" : scheduledDateTime ? "Schedule message" : "Send message"}
                    >
                      {isSavingEdit ? <Clock size={18} className="spin-icon" /> : editingMessageId ? <Check size={18} /> : isSchedulingMessage ? <Clock size={18} className="spin-icon" /> : scheduledDateTime ? <Calendar size={18} /> : <Send size={18} />}
                    </button>
                  </div>
                  </>
                )}
              </div>

              {/* WhatsApp Contact Info Right Drawer */}
              {showContactInfoDrawer && (
                <aside className="wa-contact-drawer">
                  <div className="wa-drawer-header">
                    <button
                      type="button"
                      className="chat-action-btn"
                      onClick={() => setShowContactInfoDrawer(false)}
                      style={{ width: 32, height: 32 }}
                    >
                      <X size={16} />
                    </button>
                    <h3 className="wa-drawer-title">{activeConv.type === "group" ? "Group Info" : "Contact Info"}</h3>
                  </div>

                  {(() => {
                    const peerUser = registeredUsers.find((u) => u.id === activeConv.peerUserId || u.displayName === activeConv.name);
                    const peerProtection = peerUser?.profilePhotoProtection ?? "nobody";
                    const isPeerContact = conversations.some((c) => c.peerUserId === peerUser?.id);
                    const isScreenshotBlocked = activeConv.type !== "group" && (
                      peerProtection === "nobody" ||
                      (peerProtection === "contacts" && !isPeerContact)
                    );

                    return (
                      <div className="wa-drawer-profile-card">
                        <div className="wa-drawer-avatar-wrap">
                          <img
                            src={getSafeAvatar(activeConv.avatar, activeConv.name)}
                            alt={activeConv.name}
                            className={`wa-drawer-avatar-lg ${isScreenshotBlocked ? "is-protected-avatar" : ""}`}
                            onContextMenu={(e) => {
                              if (isScreenshotBlocked) {
                                e.preventDefault();
                                setCopiedToast("This photo is restricted in ConnectSphere, but the browser cannot block device screenshots.");
                                setTimeout(() => setCopiedToast(null), 2500);
                              }
                            }}
                            onDragStart={(e) => isScreenshotBlocked && e.preventDefault()}
                          />
                          {isScreenshotBlocked && (
                            <div className="avatar-shield-watermark" title="Restricted profile photo preview">
                              <ShieldAlert size={14} />
                            </div>
                          )}
                        </div>
                        <h2 className="wa-drawer-name">{activeConv.name}</h2>
                        <p className="wa-drawer-phone">
                          {activeConv.type === "group"
                            ? `${activeConv.members?.length ?? 0} members`
                            : activeConv.peerPhone || (activeConv.name.includes("+") ? activeConv.name : "ConnectSphere User")}
                        </p>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 4 }}>
                          <span
                            style={{
                              fontSize: 12,
                              color: activeConv.isOnline ? "#00a884" : "#8696a0",
                              fontWeight: 600,
                            }}
                          >
                            {activeConv.type === "group"
                              ? `${activeConv.currentUserRole ?? "member"}`
                              : activeConv.isOnline ? "● Online" : "Offline"}
                          </span>
                          {activeConv.type !== "group" && (
                            <span className={`profile-protection-badge ${isScreenshotBlocked ? "is-blocked" : "is-allowed"}`}>
                              {isScreenshotBlocked ? (
                                <>
                                  <ShieldAlert size={12} />
                                  <span>Photo Restricted</span>
                                </>
                              ) : peerProtection === "contacts" ? (
                                <>
                                  <Users size={12} />
                                  <span>Contacts Only</span>
                                </>
                              ) : (
                                <>
                                  <Globe size={12} />
                                  <span>Public DP</span>
                                </>
                              )}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })()}

                  {activeConv.type === "group" ? (
                    <>
                      <div className="wa-drawer-section group-details-section">
                        <div className="wa-drawer-section-title">Group description</div>
                        {activeConv.currentUserRole === "owner" || activeConv.currentUserRole === "admin" ? (
                          <>
                            <input
                              className="enhanced-text-field"
                              aria-label="Group name"
                              value={groupNameDraft}
                              maxLength={120}
                              onChange={(event) => setGroupNameDraft(event.target.value)}
                            />
                            <textarea
                              className="enhanced-text-field group-description-input"
                              aria-label="Group description"
                              value={groupDescriptionDraft}
                              maxLength={1000}
                              placeholder="Add a group description"
                              onChange={(event) => setGroupDescriptionDraft(event.target.value)}
                            />
                            <button
                              type="button"
                              className="primary-action-btn group-save-btn"
                              disabled={groupActionPending || !groupNameDraft.trim()}
                              onClick={() => void handleSaveGroupDetails()}
                            >
                              Save group info
                            </button>
                          </>
                        ) : (
                          <p className="wa-drawer-bio-text">{activeConv.description || "No group description"}</p>
                        )}
                      </div>

                      <div className="wa-drawer-section group-members-section">
                        <div className="group-members-heading">
                          <div>
                            <div className="wa-drawer-section-title">Members</div>
                            <span className="group-members-count">{activeConv.members?.length ?? 0} participants</span>
                          </div>
                          {(activeConv.currentUserRole === "owner" || activeConv.currentUserRole === "admin") && (
                            <button
                              type="button"
                              className="secondary-btn group-add-member-btn"
                              onClick={() => setShowAddGroupMembers((visible) => !visible)}
                            >
                              <Plus size={14} /> Add
                            </button>
                          )}
                        </div>

                        {showAddGroupMembers && (
                          <div className="group-add-members-picker">
                            {registeredUsers
                              .filter((user) => !activeConv.members?.some((member) => member.id === user.id))
                              .map((user) => (
                                <label key={user.id} className="group-member-choice">
                                  <input
                                    type="checkbox"
                                    checked={selectedNewMemberIds.includes(user.id)}
                                    onChange={(event) => setSelectedNewMemberIds((previous) =>
                                      event.target.checked
                                        ? [...previous, user.id]
                                        : previous.filter((id) => id !== user.id)
                                    )}
                                  />
                                  <img src={user.avatar} alt="" />
                                  <span>{user.displayName}</span>
                                </label>
                              ))}
                            <button
                              type="button"
                              className="primary-action-btn"
                              disabled={groupActionPending || selectedNewMemberIds.length === 0}
                              onClick={() => void handleAddMembers()}
                            >
                              Add selected members
                            </button>
                          </div>
                        )}

                        <div className="group-member-list">
                          {(activeConv.members ?? []).map((member) => (
                            <div className="group-member-row" key={member.id}>
                              <img src={member.avatar} alt="" />
                              <div className="group-member-name">
                                <span>{member.name || "Group member"}</span>
                                {member.id === currentUser.id && <small>You</small>}
                              </div>
                              {!(activeConv.currentUserRole === "owner" && member.role !== "owner") && (
                                <span className={`group-role-badge role-${member.role}`}>{member.role}</span>
                              )}
                              {activeConv.currentUserRole === "owner" && member.role !== "owner" && (
                                <select
                                  aria-label={`Role for ${member.name}`}
                                  value={member.role}
                                  disabled={groupActionPending}
                                  onChange={(event) => void manageGroupRequest(
                                    `/api/conversations/${encodeURIComponent(activeConv.id)}/members/${encodeURIComponent(member.id)}`,
                                    "PATCH",
                                    { role: event.target.value },
                                  )}
                                >
                                  <option value="member">Member</option>
                                  <option value="admin">Admin</option>
                                </select>
                              )}
                              {(activeConv.currentUserRole === "owner" && member.role !== "owner") ||
                                (activeConv.currentUserRole === "admin" && member.role === "member") ? (
                                <button
                                  type="button"
                                  className="group-remove-member-btn"
                                  aria-label={`Remove ${member.name} from group`}
                                  disabled={groupActionPending}
                                  onClick={() => void handleRemoveGroupMember(member.id)}
                                >
                                  <X size={15} />
                                </button>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      </div>
                      {groupManageError && <p className="group-manage-error" role="alert">{groupManageError}</p>}
                      <div className="wa-drawer-section">
                        <button
                          type="button"
                          className="wa-drawer-action-btn is-danger"
                          disabled={groupActionPending}
                          onClick={() => void handleLeaveGroup()}
                        >
                          <Users size={16} />
                          <span>Leave group</span>
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="wa-drawer-section">
                        <div className="wa-drawer-section-title">About</div>
                        <p className="wa-drawer-bio-text">
                          {activeConv.description || "Hey there! I am using ConnectSphere."}
                        </p>
                      </div>
                      <div className="wa-drawer-section">
                        <div className="wa-drawer-section-title">Privacy</div>
                        <div style={{ display: "flex", alignItems: "center", gap: 10, color: "#d1d7db", fontSize: 13 }}>
                          <ShieldCheck size={18} className="text-accent" />
                          <span>Conversation members can access shared messages and files.</span>
                        </div>
                      </div>
                    </>
                  )}
                  <div className="wa-drawer-section">
                    <div className="wa-drawer-section-title">Disappearing messages</div>
                    <p className="chat-wallpaper-description">
                      The timer applies to new messages after they are sent.
                    </p>
                    <select
                      className="enhanced-text-field"
                      aria-label="Disappearing-message timer"
                      value={
                        isCustomDisappearingTimerSelected ||
                        ![0, 1, 24, 168, 720].includes(activeConv.disappearingTimerHours ?? 0)
                          ? "custom"
                          : String(activeConv.disappearingTimerHours ?? 0)
                      }
                      disabled={disappearingTimerPending}
                      onChange={(event) => {
                        if (event.target.value === "custom") {
                          setIsCustomDisappearingTimerSelected(true);
                          return;
                        }
                        setIsCustomDisappearingTimerSelected(false);
                        handleSetDisappearingTimer(Number(event.target.value));
                      }}
                    >
                      <option value="0">Off</option>
                      <option value="1">After 1 hour</option>
                      <option value="24">After 24 hours</option>
                      <option value="168">After 7 days</option>
                      <option value="720">After 30 days</option>
                      <option value="custom">Custom duration</option>
                    </select>
                    {(isCustomDisappearingTimerSelected ||
                      ![0, 1, 24, 168, 720].includes(activeConv.disappearingTimerHours ?? 0)) && (
                      <div className="wa-drawer-toggle-row" style={{ marginTop: 10 }}>
                        <label htmlFor="custom-disappearing-timer-hours">Hours (1–720)</label>
                        <input
                          id="custom-disappearing-timer-hours"
                          className="enhanced-text-field"
                          type="number"
                          min={1}
                          max={720}
                          step={1}
                          value={customDisappearingTimerHours}
                          disabled={disappearingTimerPending}
                          onChange={(event) => setCustomDisappearingTimerHours(event.target.value)}
                        />
                        <button
                          type="button"
                          className="secondary-btn"
                          disabled={
                            disappearingTimerPending ||
                            !Number.isInteger(Number(customDisappearingTimerHours)) ||
                            Number(customDisappearingTimerHours) < 1 ||
                            Number(customDisappearingTimerHours) > 720 ||
                            Number(customDisappearingTimerHours) === activeConv.disappearingTimerHours
                          }
                          onClick={() => handleSetDisappearingTimer(Number(customDisappearingTimerHours))}
                        >
                          {disappearingTimerPending ? "Saving..." : "Save"}
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="wa-drawer-section">
                    {activeConv.type !== "group" && (
                      <div className="wa-drawer-toggle-row">
                        <span style={{ fontSize: 13, color: "#d1d7db" }}>PIN Chat Lock</span>
                        <button
                          type="button"
                          className={`type-tab-btn ${activeConv.isLocked ? "is-active" : ""}`}
                          style={{ padding: "4px 12px", width: "auto" }}
                          onClick={handleToggleChatLock}
                          disabled={isUpdatingChatLock}
                        >
                          {isUpdatingChatLock
                            ? "Saving..."
                            : activeConv.isLocked
                              ? "Locked 🔒"
                              : "Unlocked 🔓"}
                        </button>
                      </div>
                    )}
                    <div className="chat-wallpaper-drawer">
                      <div className="wa-drawer-section-title">Chat background</div>
                      <p className="chat-wallpaper-description">Choose a background just for this conversation.</p>
                      <div className="chat-wallpaper-grid chat-wallpaper-drawer-grid">
                        {CHAT_WALLPAPERS.map((wallpaper) => (
                          <button
                            key={wallpaper.id}
                            type="button"
                            className={`chat-wallpaper-option ${activeChatWallpaper === wallpaper.id ? "is-selected" : ""}`}
                            onClick={() => handleChangeChatWallpaper(wallpaper.id)}
                            aria-pressed={activeChatWallpaper === wallpaper.id}
                          >
                            <span className={`chat-wallpaper-preview wallpaper-${wallpaper.id}`}>
                              {wallpaper.image && <img src={wallpaper.image} alt="" loading="lazy" />}
                            </span>
                            <span className="chat-wallpaper-option-label">{wallpaper.label}</span>
                            {activeChatWallpaper === wallpaper.id && (
                              <span className="chat-wallpaper-selected-check" aria-hidden="true">
                                <Check size={14} />
                              </span>
                            )}
                          </button>
                        ))}
                      </div>
                      <div className={`custom-wallpaper-card chat-wallpaper-custom-card ${activeChatWallpaper === CUSTOM_CHAT_WALLPAPER_ID ? "is-selected" : ""}`}>
                        <div className="custom-wallpaper-preview">
                          {customWallpaperUrl
                            ? <img src={customWallpaperUrl} alt="Custom background for this conversation" />
                            : <Upload size={20} aria-hidden="true" />}
                        </div>
                        <div className="custom-wallpaper-copy">
                          <strong>Custom background</strong>
                          <p>
                            {customWallpaperUrl
                              ? "Saved only for this conversation."
                              : "PNG, JPEG, WebP, or AVIF · 10 MB max."}
                          </p>
                        </div>
                        <div className="custom-wallpaper-actions">
                          <label className="secondary-btn custom-wallpaper-upload-button">
                            <Upload size={15} />
                            <span>{wallpaperActionPending ? "Saving..." : customWallpaperUrl ? "Change image" : "Upload image"}</span>
                            <input
                              type="file"
                              accept="image/png,image/jpeg,image/webp,image/avif"
                              onChange={(event) => void handleCustomWallpaperFileChange(event)}
                              disabled={wallpaperActionPending}
                              aria-label="Upload a custom background for this conversation"
                            />
                          </label>
                          {customWallpaperUrl && (
                            <>
                              <button
                                type="button"
                                className="primary-action-btn custom-wallpaper-apply-button"
                                onClick={() => handleChangeChatWallpaper(CUSTOM_CHAT_WALLPAPER_ID)}
                                disabled={wallpaperActionPending || activeChatWallpaper === CUSTOM_CHAT_WALLPAPER_ID}
                              >
                                {activeChatWallpaper === CUSTOM_CHAT_WALLPAPER_ID ? "Applied" : "Apply"}
                              </button>
                              <button
                                type="button"
                                className="secondary-btn custom-wallpaper-remove-button"
                                onClick={() => void handleRemoveCustomChatWallpaper()}
                                disabled={wallpaperActionPending}
                              >
                                <Trash2 size={15} />
                                Remove
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                      {wallpaperActionError && (
                        <p className="custom-wallpaper-error" role="alert">{wallpaperActionError}</p>
                      )}
                    </div>
                  </div>

                  <div className="wa-drawer-section wa-drawer-actions-card">
                    <button
                      type="button"
                      className="wa-drawer-action-btn"
                      onClick={() => {
                        setShowContactInfoDrawer(false);
                        setShowInChatSearch(true);
                      }}
                    >
                      <Search size={16} />
                      <span>Search Messages</span>
                    </button>
                    <button
                      type="button"
                      className="wa-drawer-action-btn is-danger"
                      onClick={handleClearChat}
                    >
                      <Trash2 size={16} />
                      <span>Clear Chat Messages</span>
                    </button>
                  </div>
                </aside>
              )}
            </div>
          )}

          {/* Full-Screen Image Lightbox */}
          {lightboxUrl && (
            <div className="wa-lightbox-overlay" onClick={() => setLightboxUrl(null)}>
              <div className="wa-lightbox-content" onClick={(e) => e.stopPropagation()}>
                <button
                  type="button"
                  className="wa-lightbox-close"
                  onClick={() => setLightboxUrl(null)}
                >
                  <X size={24} />
                </button>
                <img src={lightboxUrl} alt="Expanded Attachment" className="wa-lightbox-img" />
              </div>
            </div>
          )}

          {/* Delete Message Confirmation Dialog */}
          {deleteConfirmMsg && (
            <div className="modal-backdrop" onClick={() => setDeleteConfirmMsg(null)}>
              <div className="modal-card enhanced-chat-modal" onClick={(e) => e.stopPropagation()}>
                <div className="new-chat-modal-header">
                  <div className="new-chat-header-brand">
                    <div className="new-chat-header-icon-wrap" style={{ color: "#ef4444" }}>
                      <Trash2 size={20} />
                    </div>
                    <div>
                      <h3 className="new-chat-title">Delete message?</h3>
                      <p className="new-chat-subtitle">Choose how to delete this message</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="modal-close-btn"
                    onClick={() => setDeleteConfirmMsg(null)}
                  >
                    <X size={18} />
                  </button>
                </div>
                <div className="modal-body enhanced-modal-body">
                  <p style={{ fontSize: 13.5, color: "#d1d7db", margin: "4px 0 16px" }}>
                    "{deleteConfirmMsg.text.slice(0, 80)}"
                  </p>
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {deleteConfirmMsg.senderId === currentUser.id && (
                      <>
                        <button
                          type="button"
                          className="ghost-unsend-action-btn"
                          onClick={() => handleDeleteMessage(deleteConfirmMsg, true, true)}
                        >
                          <Ghost size={18} />
                          <div style={{ textAlign: "left" }}>
                            <div style={{ fontWeight: 600, fontSize: 13.5 }}>Ghost Unsend (No Trace)</div>
                            <div style={{ fontSize: 11, opacity: 0.88, fontWeight: 400 }}>Vanishes cleanly without leaving "This message was deleted"</div>
                          </div>
                        </button>

                        <button
                          type="button"
                          className="secondary-btn"
                          style={{ borderColor: "rgba(239, 68, 68, 0.35)", color: "#f87171", display: "flex", alignItems: "center", gap: 10, padding: "10px 14px" }}
                          onClick={() => handleDeleteMessage(deleteConfirmMsg, true, false)}
                        >
                          <Trash2 size={16} />
                          <div style={{ textAlign: "left" }}>
                            <div style={{ fontWeight: 600, fontSize: 13.5 }}>Delete for everyone (With Trace)</div>
                            <div style={{ fontSize: 11, opacity: 0.75, color: "#cbd5e1" }}>Leaves standard "This message was deleted" notification</div>
                          </div>
                        </button>
                      </>
                    )}
                    <button
                      type="button"
                      className="secondary-btn"
                      onClick={() => handleDeleteMessage(deleteConfirmMsg, false)}
                    >
                      Delete for me
                    </button>
                    <button
                      type="button"
                      className="secondary-btn"
                      onClick={() => setDeleteConfirmMsg(null)}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Forward Messages Modal */}
          {forwardModalMessages.length > 0 && !isSelectingForwardMessages && (
            <div className="modal-backdrop" onClick={closeForwardFlow}>
              <div
                className="modal-card enhanced-chat-modal forward-messages-modal"
                role="dialog"
                aria-modal="true"
                aria-labelledby="forward-messages-title"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="new-chat-modal-header">
                  <div className="new-chat-header-brand">
                    <div className="new-chat-header-icon-wrap">
                      <Forward size={20} />
                    </div>
                    <div>
                      <h3 className="new-chat-title" id="forward-messages-title">
                        Forward {forwardModalMessages.length} message{forwardModalMessages.length === 1 ? "" : "s"}
                      </h3>
                      <p className="new-chat-subtitle">Choose one or more chats</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="modal-close-btn"
                    onClick={closeForwardFlow}
                    aria-label="Close forward dialog"
                  >
                    <X size={18} />
                  </button>
                </div>
                <div className="modal-body enhanced-modal-body forward-modal-body">
                  <div className="forward-message-preview-list">
                    <p className="forward-privacy-note">Original sender details are not included.</p>
                    {forwardModalMessages.map((message, index) => (
                      <div className="forward-message-preview" key={message.id}>
                        <strong>
                          {message.sharedContact?.name ??
                            (message.poll ? `Poll: ${message.poll.question}` : null) ??
                            (message.voiceNote ? "Voice message" : null) ??
                            (message.attachments?.length ? message.attachments.map((item) => item.name).join(", ") : null) ??
                            "Message"}
                        </strong>
                        {message.forwardingCaption && (
                          <span className="forward-preview-caption">{message.forwardingCaption}</span>
                        )}
                        {message.text && <p>{message.text}</p>}
                        {message.attachments?.length ? (
                          <span>{message.attachments.length} attachment{message.attachments.length === 1 ? "" : "s"}</span>
                        ) : null}
                        {index === 0 && forwardModalMessages.length > 1 && (
                          <span className="forward-preview-order">First of {forwardModalMessages.length}</span>
                        )}
                      </div>
                    ))}
                  </div>

                  <button
                    type="button"
                    className="forward-add-more-btn"
                    onClick={() => setIsSelectingForwardMessages(true)}
                  >
                    <Plus size={15} />
                    Add more messages
                  </button>

                  <label className="forward-search-wrap">
                    <Search size={16} aria-hidden="true" />
                    <input
                      type="search"
                      className="forward-search-input"
                      value={forwardSearchQuery}
                      onChange={(event) => setForwardSearchQuery(event.target.value)}
                      placeholder="Search contacts and groups"
                      aria-label="Search forwarding destinations"
                    />
                  </label>

                  <div className="forward-conversation-list" role="group" aria-label="Forward destinations">
                    {conversations
                      .filter((conversation) => {
                        const query = forwardSearchQuery.trim().toLowerCase();
                        return !query || `${conversation.name} ${conversation.description}`.toLowerCase().includes(query);
                      })
                      .map((conversation) => {
                        const selected = forwardRecipientIds.includes(conversation.id);
                        return (
                          <button
                            type="button"
                            key={conversation.id}
                            className={`registered-user-card forward-conversation-card ${selected ? "is-selected" : ""}`}
                            aria-pressed={selected}
                            onClick={() => toggleForwardRecipient(conversation.id)}
                          >
                            <span className="user-card-info">
                              <span className="forward-user-avatar-wrap">
                                <img src={conversation.avatar} alt="" className="user-avatar-thumb" />
                              </span>
                              <span className="user-text-meta">
                                <span className="user-display-name">{conversation.name}</span>
                                <span className="user-handle">
                                  {conversation.type === "direct" ? "Contact" : "Group"}
                                  {conversation.description ? ` · ${conversation.description}` : ""}
                                </span>
                              </span>
                            </span>
                            <span className={`forward-recipient-check ${selected ? "is-checked" : ""}`}>
                              {selected && <Check size={14} />}
                            </span>
                          </button>
                        );
                      })}
                    {conversations.length > 0 &&
                      !conversations.some((conversation) => {
                        const query = forwardSearchQuery.trim().toLowerCase();
                        return !query || `${conversation.name} ${conversation.description}`.toLowerCase().includes(query);
                      }) && <p className="forward-empty-state">No chats match that search.</p>}
                    {conversations.length === 0 && <p className="forward-empty-state">No chats available to forward to.</p>}
                  </div>

                  <label className="forward-caption-label">
                    <span>Optional caption</span>
                    <textarea
                      value={forwardCaption}
                      onChange={(event) => setForwardCaption(event.target.value)}
                      maxLength={1000}
                      placeholder="Add a note"
                    />
                  </label>
                  <div className="forward-modal-footer">
                    <button type="button" className="secondary-btn" onClick={closeForwardFlow}>Cancel</button>
                    <button
                      type="button"
                      className="enhanced-start-btn"
                      disabled={forwardRecipientIds.length === 0}
                      onClick={handleForwardMessages}
                    >
                      <Forward size={15} />
                      Forward to {forwardRecipientIds.length} chat{forwardRecipientIds.length === 1 ? "" : "s"}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Message Info Modal */}
          {infoModalMsg && (
            <div className="modal-backdrop" onClick={() => setInfoModalMsg(null)}>
              <div
                className="modal-card enhanced-chat-modal message-info-modal"
                role="dialog"
                aria-modal="true"
                aria-labelledby="message-info-title"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="new-chat-modal-header">
                  <div className="new-chat-header-brand">
                    <div className="new-chat-header-icon-wrap">
                      <Info size={20} />
                    </div>
                    <div>
                      <h3 className="new-chat-title" id="message-info-title">Message info</h3>
                      <p className="new-chat-subtitle">Delivery and read status</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="modal-close-btn"
                    onClick={() => setInfoModalMsg(null)}
                    aria-label="Close message info"
                  >
                    <X size={18} />
                  </button>
                </div>
                <div className="modal-body enhanced-modal-body message-info-body">
                  <div className="message-info-preview">
                    <p>{infoModalMsg.text || (infoModalMsg.attachments?.length ? "Attachment" : "Message")}</p>
                    <time>
                      {parseMessageDate(infoModalMsg.timestamp)?.toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      }) ?? infoModalMsg.timestamp}
                    </time>
                  </div>
                  <div className="message-info-timeline">
                    <div className="message-info-event">
                      <span className="message-info-event-icon is-sent"><Check size={14} /></span>
                      <div className="message-info-event-copy">
                        <span>{infoModalMsg.senderId === currentUser.id ? "Sent" : "Received"}</span>
                        <time dateTime={infoModalMsg.timestamp}>
                          {parseMessageDate(infoModalMsg.timestamp)?.toLocaleString([], {
                            dateStyle: "medium",
                            timeStyle: "short",
                          }) ?? infoModalMsg.timestamp}
                        </time>
                      </div>
                    </div>
                    {(infoModalMsg.status === "delivered" || infoModalMsg.status === "read") && (
                      <div className="message-info-event">
                        <span className="message-info-event-icon is-delivered"><CheckCheck size={14} /></span>
                        <div className="message-info-event-copy">
                          <span>Delivered</span>
                        </div>
                      </div>
                    )}
                    {infoModalMsg.status === "read" && (
                      <div className="message-info-event">
                        <span className="message-info-event-icon is-read"><Eye size={14} /></span>
                        <div className="message-info-event-copy">
                          <span>Read</span>
                        </div>
                      </div>
                    )}
                    {(infoModalMsg.status === "pending" || infoModalMsg.status === "failed") && (
                      <div className={`message-info-status-note is-${infoModalMsg.status}`} role="status">
                        {infoModalMsg.status === "pending"
                          ? "Waiting for a network connection"
                          : "This message could not be sent"}
                      </div>
                    )}
                    {infoModalMsg.status === "sent" && (
                      <div className="message-info-status-note">
                        Waiting for delivery confirmation
                      </div>
                    )}
                    {infoModalMsg.senderId === currentUser.id && (
                      <section className="message-info-receipts" aria-live="polite">
                        <h4>Recipients</h4>
                        {infoReadReceiptsLoading && (
                          <p className="message-info-receipts-note">Loading receipt details…</p>
                        )}
                        {infoReadReceiptsError && (
                          <p className="message-info-receipts-note is-error" role="alert">
                            {infoReadReceiptsError}
                          </p>
                        )}
                        {!infoReadReceiptsLoading && !infoReadReceiptsError &&
                          infoReadReceipts.length === 0 && (
                            <p className="message-info-receipts-note">No recipient details are available.</p>
                          )}
                        {infoReadReceipts.length > 0 && (
                          <ul>
                            {infoReadReceipts.map((receipt) => {
                              const timestamp = receipt.readAt ?? receipt.deliveredAt ?? null;
                              const statusLabel = receipt.status === "read"
                                ? "Read"
                                : receipt.status === "delivered"
                                  ? "Delivered"
                                  : receipt.status === "sent"
                                    ? "Waiting for delivery"
                                    : receipt.status === "unavailable"
                                      ? "Status unavailable"
                                      : "Not available";
                              return (
                                <li key={receipt.userId}>
                                  <img
                                    src={getSafeAvatar(receipt.avatar, receipt.name)}
                                    alt=""
                                    aria-hidden="true"
                                  />
                                  <span className="message-info-recipient-name">{receipt.name}</span>
                                  <span className={`message-info-recipient-status is-${receipt.status}`}>
                                    {statusLabel}
                                  </span>
                                  {timestamp && (
                                    <time dateTime={timestamp}>
                                      {parseMessageDate(timestamp)?.toLocaleString([], {
                                        dateStyle: "medium",
                                        timeStyle: "short",
                                      }) ?? timestamp}
                                    </time>
                                  )}
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </section>
                    )}
                    <div className="message-info-footer">
                      <ShieldCheck size={15} />
                      <span>Message status is based on available delivery receipts.</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {showContactShareModal && (
            <div className="modal-backdrop" onClick={() => setShowContactShareModal(false)}>
              <div
                className="modal-card enhanced-chat-modal"
                role="dialog"
                aria-modal="true"
                aria-labelledby="share-contact-title"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="new-chat-modal-header">
                  <div className="new-chat-header-brand">
                    <div className="new-chat-header-icon-wrap">
                      <UserIcon size={20} />
                    </div>
                    <div>
                      <h3 className="new-chat-title" id="share-contact-title">Share contact</h3>
                      <p className="new-chat-subtitle">Choose the details to share with this conversation</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="modal-close-btn"
                    onClick={() => setShowContactShareModal(false)}
                    aria-label="Close contact sharing"
                  >
                    <X size={18} />
                  </button>
                </div>
                <form className="modal-body enhanced-modal-body" onSubmit={handleShareContact}>
                  <button
                    type="button"
                    className="secondary-btn"
                    style={{ width: "100%", marginBottom: 14 }}
                    onClick={() => void handlePickDeviceContact()}
                    disabled={isPickingDeviceContact}
                  >
                    {isPickingDeviceContact ? "Opening contacts..." : "Choose from device contacts"}
                  </button>
                  <label className="poll-create-field">
                    <span className="poll-field-name">Name</span>
                    <input
                      className="enhanced-text-field"
                      autoComplete="name"
                      maxLength={120}
                      required
                      value={contactNameDraft}
                      onChange={(event) => {
                        setContactNameDraft(event.target.value);
                        setContactShareError(null);
                      }}
                    />
                  </label>
                  <label className="poll-create-field">
                    <span className="poll-field-name">Phone number</span>
                    <input
                      className="enhanced-text-field"
                      type="tel"
                      autoComplete="tel"
                      maxLength={40}
                      value={contactPhoneDraft}
                      onChange={(event) => {
                        setContactPhoneDraft(event.target.value);
                        setContactShareError(null);
                      }}
                    />
                  </label>
                  <label className="poll-create-field">
                    <span className="poll-field-name">Email address</span>
                    <input
                      className="enhanced-text-field"
                      type="email"
                      autoComplete="email"
                      maxLength={254}
                      value={contactEmailDraft}
                      onChange={(event) => {
                        setContactEmailDraft(event.target.value);
                        setContactShareError(null);
                      }}
                    />
                  </label>
                  <div
                    className="shared-contact-preview"
                    aria-label="Contact card preview"
                    style={{
                      padding: 12,
                      marginTop: 10,
                      borderRadius: 10,
                      background: "rgba(0, 168, 132, 0.08)",
                      border: "1px solid rgba(0, 168, 132, 0.2)",
                    }}
                  >
                    <strong>{contactNameDraft.trim() || "Contact name"}</strong>
                    {contactPhoneDraft.trim() && <div>{contactPhoneDraft.trim()}</div>}
                    {contactEmailDraft.trim() && <div>{contactEmailDraft.trim()}</div>}
                    {!contactPhoneDraft.trim() && !contactEmailDraft.trim() && (
                      <div style={{ opacity: 0.7 }}>Add a phone number or email address</div>
                    )}
                  </div>
                  <p className="poll-field-hint">
                    Only the details shown above will be shared with conversation members.
                  </p>
                  {contactShareError && (
                    <p className="group-manage-error" role="alert">{contactShareError}</p>
                  )}
                  <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 16 }}>
                    <button
                      type="button"
                      className="secondary-btn"
                      onClick={() => setShowContactShareModal(false)}
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="primary-action-btn"
                      disabled={
                        !contactNameDraft.trim() ||
                        (!contactPhoneDraft.trim() && !contactEmailDraft.trim())
                      }
                    >
                      Share contact
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {/* Create WhatsApp Poll Modal */}
          {showPollModal && (
            <div className="modal-backdrop" onClick={() => setShowPollModal(false)}>
              <div
                className="modal-card enhanced-chat-modal poll-create-modal"
                role="dialog"
                aria-modal="true"
                aria-labelledby="create-poll-title"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="new-chat-modal-header">
                  <div className="new-chat-header-brand">
                    <div className="new-chat-header-icon-wrap poll-create-icon">
                      <BarChart2 size={20} />
                    </div>
                    <div>
                      <h3 className="new-chat-title" id="create-poll-title">Create Poll</h3>
                      <p className="new-chat-subtitle">Ask a question to poll recipients</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="modal-close-btn"
                    onClick={() => setShowPollModal(false)}
                    aria-label="Close poll creator"
                  >
                    <X size={18} />
                  </button>
                </div>
                <form
                  className="modal-body enhanced-modal-body poll-create-body"
                  onSubmit={(event) => {
                    event.preventDefault();
                    handleCreatePollSubmit();
                  }}
                >
                  <div className="poll-create-field">
                    <div className="poll-field-label-row">
                      <label htmlFor="create-poll-question">Question</label>
                      <span>{pollQuestion.length}/180</span>
                    </div>
                    <div className="poll-input-shell">
                      <input
                        id="create-poll-question"
                        type="text"
                        className="poll-create-input"
                        placeholder="What would you like to ask?"
                        value={pollQuestion}
                        onChange={(event) => {
                          setPollQuestion(event.target.value);
                          setPollFormError(null);
                        }}
                        maxLength={180}
                        autoFocus
                        required
                      />
                    </div>
                    <p className="poll-field-hint">Keep the question short and easy to answer.</p>
                  </div>

                  <div className="poll-create-field">
                    <div className="poll-field-label-row">
                      <span className="poll-field-name" id="create-poll-options-label">Options</span>
                      <span>{pollOptions.length}/6</span>
                    </div>
                    <div className="poll-create-options" role="group" aria-labelledby="create-poll-options-label">
                      {pollOptions.map((option, index) => (
                        <div className="poll-create-option-row" key={option.id}>
                          <span className="poll-option-index">{index + 1}</span>
                          <div className="poll-input-shell">
                            <input
                              type="text"
                              className="poll-create-input"
                              placeholder={`Option ${index + 1}`}
                              value={option.text}
                              onChange={(event) => {
                                const text = event.target.value;
                                setPollOptions((previous) => previous.map((item) =>
                                  item.id === option.id ? { ...item, text } : item
                                ));
                                setPollFormError(null);
                              }}
                              maxLength={200}
                              aria-label={`Option ${index + 1}`}
                            />
                          </div>
                          {pollOptions.length > 2 && (
                            <button
                              type="button"
                              className="poll-remove-option-btn"
                              onClick={() => {
                                setPollOptions((previous) => previous.filter((item) => item.id !== option.id));
                                setPollFormError(null);
                              }}
                              aria-label={`Remove option ${index + 1}`}
                              title={`Remove option ${index + 1}`}
                            >
                              <X size={16} />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                    {pollOptions.length < 6 && (
                      <button
                        type="button"
                        className="poll-add-option-btn"
                        onClick={() => setPollOptions((previous) => [...previous, createPollOptionDraft()])}
                      >
                        <Plus size={16} />
                        <span>Add option</span>
                      </button>
                    )}
                  </div>

                  <label className="poll-multiple-toggle">
                    <input
                      type="checkbox"
                      checked={pollAllowMultiple}
                      onChange={(event) => setPollAllowMultiple(event.target.checked)}
                    />
                    <span className="poll-custom-checkbox" aria-hidden="true">
                      {pollAllowMultiple && <Check size={12} strokeWidth={3} />}
                    </span>
                    <span className="poll-toggle-copy">
                      <strong>Allow multiple answers</strong>
                      <small>People can select more than one option.</small>
                    </span>
                  </label>

                  {pollFormError && <p className="poll-form-error" role="alert">{pollFormError}</p>}

                  <div className="modal-footer-btns poll-create-footer">
                    <button
                      type="button"
                      className="secondary-btn"
                      onClick={() => setShowPollModal(false)}
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="primary-action-btn enhanced-start-btn poll-send-btn"
                      disabled={!pollQuestion.trim() || pollOptions.filter((option) => option.text.trim()).length < 2}
                    >
                      <Send size={16} />
                      <span>Send poll</span>
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {/* Schedule Message Modal */}
          {showScheduleModal && (
            <div className="modal-backdrop schedule-modal-backdrop" onClick={() => setShowScheduleModal(false)}>
              <div
                className="modal-card enhanced-chat-modal schedule-message-modal"
                role="dialog"
                aria-modal="true"
                aria-labelledby="schedule-message-title"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="new-chat-modal-header">
                  <div className="new-chat-header-brand">
                    <div className="new-chat-header-icon-wrap schedule-modal-icon">
                      <Calendar size={20} />
                    </div>
                    <div>
                      <h3 className="new-chat-title" id="schedule-message-title">Schedule Message Delivery</h3>
                      <p className="new-chat-subtitle">Choose when your next text message should arrive</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="modal-close-btn"
                    onClick={() => setShowScheduleModal(false)}
                    aria-label="Close schedule dialog"
                  >
                    <X size={18} />
                  </button>
                </div>
                <form
                  className="modal-body enhanced-modal-body schedule-message-body"
                  onSubmit={(event) => {
                    event.preventDefault();
                    handleConfirmScheduleTime();
                  }}
                >
                  <div className="schedule-message-field">
                    <label className="field-label" htmlFor="scheduled-message-time">Delivery date &amp; time</label>
                    <input
                      id="scheduled-message-time"
                      type="datetime-local"
                      className="enhanced-text-field schedule-date-input"
                      value={scheduledDateTime}
                      min={minimumScheduledDateTime}
                      onChange={(event) => {
                        setScheduledDateTime(event.target.value);
                        setScheduleFormError(null);
                      }}
                      required
                    />
                    <p className="schedule-message-hint">
                      {inputText.trim()
                        ? "Your draft stays in the composer. Press the calendar send button when you're ready to schedule it."
                        : "Set a time first, then write your message. Media, polls, and voice notes send immediately."}
                    </p>
                  </div>
                  {inputText.trim() && (
                    <div className="schedule-message-preview">
                      <span>Message draft</span>
                      <p>{inputText.trim()}</p>
                    </div>
                  )}
                  {scheduleFormError && <p className="schedule-message-error" role="alert">{scheduleFormError}</p>}
                  <div className="modal-footer-btns schedule-message-actions">
                    <button
                      type="button"
                      className="secondary-btn"
                      onClick={() => setShowScheduleModal(false)}
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="primary-action-btn enhanced-start-btn schedule-confirm-btn"
                      disabled={!hasValidScheduledDateTime}
                    >
                      <Calendar size={17} />
                      Set Scheduled Time
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </main>
      ) : (
        <div className="chat-placeholder-area">
          <div className="placeholder-ambient-glow" />
          <div className="chat-placeholder-content">
            <div className="placeholder-hero-badge">
              <div className="placeholder-icon-halo" />
              <img src="/logo.svg" alt="ConnectSphere" className="placeholder-brand-horizontal-logo" />
            </div>

            <h2 className="placeholder-title">ConnectSphere Web</h2>
            <p className="placeholder-subtitle">
              Fast, encrypted real-time messaging, HD voice & video calls, and collaborative team workspaces.
            </p>

            <div className="placeholder-cta-row">
              <button
                type="button"
                className="placeholder-primary-btn"
                onClick={() => setShowNewChatModal(true)}
              >
                <Plus size={18} />
                <span>Start New Conversation</span>
              </button>
            </div>

            <div className="placeholder-features-grid">
              <div className="placeholder-feature-card">
                <div className="feature-card-icon-wrap">
                  <MessageSquare size={20} />
                </div>
                <h4>Real-time Chat</h4>
                <p>Instant messaging, typing status, voice notes, media, and reactions.</p>
              </div>

              <div className="placeholder-feature-card">
                <div className="feature-card-icon-wrap">
                  <Video size={20} />
                </div>
                <h4>HD Voice & Video</h4>
                <p>Crystal clear peer-to-peer audio and video calls with WebRTC.</p>
              </div>

              <div className="placeholder-feature-card">
                <div className="feature-card-icon-wrap">
                  <ShieldCheck size={20} />
                </div>
                <h4>Private & Secure</h4>
                <p>Encrypted sessions, zero mock data, and personal app lock.</p>
              </div>
            </div>

            <div className="placeholder-encryption-note">
              <Lock size={13} />
              <span>End-to-end encrypted • Personal messages and calls stay private</span>
            </div>
          </div>
        </div>
      )}

      {/* New Chat Modal */}
      {showNewChatModal && (
        <div className="modal-backdrop" onClick={() => setShowNewChatModal(false)}>
          <div className="modal-card new-chat-modal enhanced-chat-modal" onClick={(e) => e.stopPropagation()}>
            <div className="new-chat-modal-header">
              <div className="new-chat-header-brand">
                <div className="new-chat-header-icon-wrap">
                  <MessageSquare size={22} />
                </div>
                <div>
                  <h3 className="new-chat-title">New Conversation</h3>
                  <p className="new-chat-subtitle">Search registered contacts or start a group</p>
                </div>
              </div>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => {
                  setShowNewChatModal(false);
                  setLookupError(null);
                }}
                aria-label="Close dialog"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleCreateNewChat} className="modal-body enhanced-modal-body">
              <div className="new-chat-type-selector enhanced-type-selector">
                <button
                  type="button"
                  className={`type-tab-btn ${newChatType === "direct" ? "is-active" : ""}`}
                  onClick={() => {
                    setNewChatType("direct");
                    setLookupError(null);
                  }}
                >
                  <UserIcon size={15} /> Direct Message
                </button>
                <button
                  type="button"
                  className={`type-tab-btn ${newChatType === "group" ? "is-active" : ""}`}
                  onClick={() => {
                    setNewChatType("group");
                    setLookupError(null);
                  }}
                >
                  <Users size={15} /> Group Space
                </button>
              </div>

              <div className="field-group">
                <label className="field-label">
                  {newChatType === "direct"
                    ? "Search Registered People or Enter Email / Username"
                    : "Group Name or Topic"}
                </label>
                <div className="enhanced-input-wrapper">
                  <div className="input-leading-icon">
                    {newChatType === "direct" ? <Search size={17} /> : <Hash size={17} />}
                  </div>
                  <input
                    type="text"
                    className="enhanced-text-field"
                    placeholder={
                      newChatType === "direct"
                        ? "Search by name, @username, or email..."
                        : "e.g. Mobile Engineering Team"
                    }
                    value={newChatName}
                    onChange={(e) => {
                      setNewChatName(e.target.value);
                      if (lookupError) setLookupError(null);
                    }}
                    autoFocus
                    required={newChatType === "group"}
                  />
                  {newChatName && (
                    <button
                      type="button"
                      className="clear-search-btn"
                      onClick={() => setNewChatName("")}
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
                {newChatType === "group" && !newChatName.trim() && (
                  <p className="group-name-hint">A group name is required before you can create it.</p>
                )}
              </div>

              {newChatType === "direct" && (
                <div className="registered-users-section">
                  <div className="registered-users-header">
                    <Sparkles size={13} className="text-accent" />
                    <span>
                      {newChatName.trim()
                        ? `Matching Members (${registeredUsers.filter((u) => {
                            const q = newChatName.trim().toLowerCase();
                            return (
                              u.displayName?.toLowerCase().includes(q) ||
                              u.username?.toLowerCase().includes(q) ||
                              u.email?.toLowerCase().includes(q)
                            );
                          }).length})`
                        : `ConnectSphere Directory (${registeredUsers.length})`}
                    </span>
                  </div>
                  {registeredUsers.length > 0 ? (
                    <div className="registered-users-list">
                      {registeredUsers
                        .filter((u) => {
                          if (!newChatName.trim()) return true;
                          const q = newChatName.trim().toLowerCase();
                          return (
                            u.displayName?.toLowerCase().includes(q) ||
                            u.username?.toLowerCase().includes(q) ||
                            u.email?.toLowerCase().includes(q)
                          );
                        })
                        .map((u) => (
                          <div key={u.id} className="registered-user-card">
                            <div className="user-card-info">
                              <div className="user-avatar-wrap">
                                <img
                                  src={getSafeAvatar(u.avatar, u.displayName)}
                                  alt={u.displayName}
                                  className="user-avatar-thumb"
                                />
                                <span className="user-online-pill" />
                              </div>
                              <div className="user-text-meta">
                                <span className="user-display-name">{u.displayName}</span>
                                <span className="user-handle">{u.username ? `@${u.username}` : (u.email || "Member")}</span>
                              </div>
                            </div>
                            <button
                              type="button"
                              className="user-chat-action-btn"
                              onClick={() => handleStartChatWithUser(u)}
                            >
                              <MessageSquare size={13} /> Chat
                            </button>
                          </div>
                        ))}
                    </div>
                  ) : (
                    <p className="group-empty-members">No other registered users yet. Invite teammates to join ConnectSphere!</p>
                  )}
                </div>
              )}

              {newChatType === "group" && (
                <div className="registered-users-section">
                  <div className="registered-users-header">
                    <Users size={14} className="text-accent" />
                    <span>Add members ({selectedGroupMemberIds.length} selected)</span>
                  </div>
                  {registeredUsers.length > 0 ? (
                    <div className="registered-users-list group-create-member-list">
                      {registeredUsers.map((user) => (
                        <label key={user.id} className="registered-user-card group-create-member-card">
                          <div className="user-card-info">
                            <div className="user-avatar-wrap">
                              <img
                                src={getSafeAvatar(user.avatar, user.displayName)}
                                alt=""
                                className="user-avatar-thumb"
                              />
                            </div>
                            <div className="user-text-meta">
                              <span className="user-display-name">{user.displayName}</span>
                              <span className="user-handle">{user.username ? `@${user.username}` : (user.email || "Member")}</span>
                            </div>
                          </div>
                          <input
                            type="checkbox"
                            checked={selectedGroupMemberIds.includes(user.id)}
                            onChange={(event) => setSelectedGroupMemberIds((previous) =>
                              event.target.checked
                                ? [...previous, user.id]
                                : previous.filter((id) => id !== user.id)
                            )}
                          />
                        </label>
                      ))}
                    </div>
                  ) : (
                    <p className="group-empty-members">No other registered users are available to add yet.</p>
                  )}
                </div>
              )}

              {lookupError && (
                <div className="wa-error-banner lookup-error-banner">
                  <div className="error-text-row">
                    <AlertCircle size={17} className="error-icon" />
                    <span>{lookupError}</span>
                  </div>
                  {newChatType === "direct" && (
                    <button
                      type="button"
                      className="invite-link-btn"
                      onClick={shareMyInviteLink}
                    >
                      Share Invite Link
                    </button>
                  )}
                </div>
              )}

              <div className="modal-encryption-tag">
                <ShieldCheck size={14} className="text-accent" />
                <span>Conversations are shared with their members.</span>
              </div>

              <div className="modal-footer-btns">
                <button
                  type="button"
                  className="secondary-btn"
                  onClick={() => {
                    setShowNewChatModal(false);
                    setLookupError(null);
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="primary-action-btn enhanced-start-btn"
                  disabled={
                    (newChatType === "direct" && !newChatName.trim()) ||
                    isLookingUp ||
                    isCreatingGroup ||
                    (newChatType === "group" && selectedGroupMemberIds.length === 0)
                  }
                >
                  {isLookingUp || isCreatingGroup ? (
                    <>
                      <RefreshCw size={15} className="spin-icon" />
                      <span>{isCreatingGroup ? "Creating group..." : "Verifying..."}</span>
                    </>
                  ) : (
                    <>
                      <ArrowRight size={16} />
                      <span>{newChatType === "group" ? "Create Group" : "Start Chat"}</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
