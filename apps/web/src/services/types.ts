export type ProfilePhotoProtection = "nobody" | "contacts" | "everyone";

export type User = {
  id: string;
  email?: string;
  username: string;
  displayName: string;
  avatar: string;
  bio?: string;
  statusText?: string;
  isOnline?: boolean;
  phone?: string;
  isVerified?: boolean;
  profilePhotoProtection?: ProfilePhotoProtection;
};

export type MessageStatus = "scheduled" | "pending" | "sent" | "delivered" | "read" | "failed";

export type Attachment = {
  id: string;
  type: "image" | "file" | "video" | "audio";
  name: string;
  size: string;
  url: string;
  storage?: "r2";
  previewUrl?: string;
};

export type VoiceNoteData = {
  durationSec: number;
  waveform: number[];
  audioUrl?: string | undefined;
};

export type PollOption = {
  id: string;
  text: string;
  votes: string[]; // array of userIds
};

export type PollData = {
  question: string;
  options: PollOption[];
  multipleAnswers?: boolean | undefined;
};

export type Message = {
  id: string;
  conversationId: string;
  senderId: string;
  senderName: string;
  senderAvatar: string;
  text: string;
  timestamp: string;
  status: MessageStatus;
  replyTo?: {
    id: string;
    senderName: string;
    text: string;
  } | undefined;
  reactions?: Record<string, string[]> | undefined; // emoji -> array of userIds
  attachments?: Attachment[] | undefined;
  voiceNote?: VoiceNoteData | undefined;
  poll?: PollData | undefined;
  isPinned?: boolean | undefined;
  isStarred?: boolean | undefined;
  isEdited?: boolean | undefined;
  isDeleted?: boolean | undefined; // deleted for everyone
  deletedForUserIds?: string[] | undefined; // deleted for specific users
  scheduledFor?: string | undefined;
  linkPreviewDisabled?: boolean | undefined;
  expiresInSeconds?: number | undefined;
  expiresAt?: string | undefined;
  targetUserId?: string | undefined;
  targetPhone?: string | undefined;
};

export type ConversationMember = {
  id: string;
  name: string;
  avatar: string;
  role: "owner" | "admin" | "member";
  isOnline?: boolean;
};

export type Conversation = {
  id: string;
  type: "direct" | "group" | "community-channel";
  name: string;
  avatar: string;
  peerUserId?: string | undefined;
  peerEmail?: string | undefined;
  peerPhone?: string | undefined;
  isOnline?: boolean;
  lastSeen?: string;
  isTyping?: boolean;
  typingUser?: string;
  unreadCount: number;
  isPinned?: boolean;
  isMuted?: boolean;
  isArchived?: boolean;
  isLocked?: boolean;
  disappearingTimerHours?: number; // 0 = off, 24, 168 (7d), etc.
  wallpaper?: string;
  members?: ConversationMember[];
  currentUserRole?: ConversationMember["role"];
  lastMessage?: Message | undefined;
  description?: string;
  communityName?: string;
};

export type CallType = "voice" | "video";
export type CallDirection = "incoming" | "outgoing" | "missed" | "declined";

export type CallParticipant = Pick<User, "id" | "displayName" | "avatar">;

export type CallRecord = {
  id: string;
  peerId: string;
  peerName: string;
  peerAvatar: string;
  type: CallType;
  direction: CallDirection;
  timestamp: string;
  durationSec: number;
};

export type WebRtcTelemetrySample = {
  timestampMs: number;
  roundTripTimeMs: number;
  jitterMs: number;
  packetLossPercent: number;
  availableOutgoingBitrateBps: number;
  sendingBitrateBps: number;
  resolution: "1080p" | "720p" | "480p" | "360p" | "240p" | "Audio-Only";
  fps: number;
};

export type RecoveryRiskLevel = "NORMAL" | "ELEVATED" | "HIGH" | "CRITICAL" | "UNKNOWN";

export type RecoveryRiskEstimate = {
  level: RecoveryRiskLevel;
  score: number;
  confidence: "LOW" | "MEDIUM";
  sampleCount: number;
  observedWindowMs: number;
  adaptationAction: string;
  timestampMs: number;
};

export type WhiteboardStroke = {
  id: string;
  type: "pen" | "highlighter" | "rect" | "circle" | "arrow" | "text";
  color: string;
  width: number;
  points?: { x: number; y: number }[];
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  text?: string;
};

export type CollaborativeDoc = {
  id: string;
  title: string;
  content: string;
  updatedAt: string;
  tasks: { id: string; text: string; done: boolean }[];
  activeAuthors: { name: string; color: string }[];
};
