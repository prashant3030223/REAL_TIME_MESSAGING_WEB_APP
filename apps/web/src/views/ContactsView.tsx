import { useState, useEffect, useCallback } from "react";
import {
  Users,
  Search,
  UserPlus,
  Phone,
  Video,
  MessageSquare,
  Hash,
  Link,
  Shield,
  ShieldCheck,
  Check,
  X,
  Compass,
  Plus,
  Sparkles,
  AlertCircle,
  ArrowRight,
  RefreshCw,
  User as UserIcon,
  Globe,
  Radio,
  Lock,
  Mail,
  AtSign,
} from "lucide-react";
import type { User, Conversation } from "../services/types.js";
import { getSafeAvatar } from "../services/avatars.js";
import { InviteLinkManualCopy } from "../components/InviteLinkManualCopy.js";
import { createInviteLink, shareInviteUrl, type InviteShareResult } from "../services/inviteLinks.js";
import { formatLastSeen } from "../services/time.js";

type ContactsViewProps = {
  conversations: Conversation[];
  onStartChat: (conversationId: string) => void;
  onStartCall: (peerName: string, peerAvatar: string, isVideo: boolean, targetUserId?: string, targetPhone?: string) => void;
  currentUser: User;
  onAddConversation?: (conv: Conversation) => Promise<Conversation | void>;
};

type CommunityItem = {
  id: string;
  name: string;
  description: string;
  memberCount: number;
  channels: Array<{ name: string; desc: string }>;
};

type ConnectionRequest = {
  id: string;
  userId: string;
  displayName: string;
  username: string;
  avatar: string;
  email?: string;
  phone?: string;
  bio?: string;
  profilePhotoProtection?: User["profilePhotoProtection"];
};

function ConnectionRequestsPanel({
  receivedRequests,
  sentRequests,
  workingUserId,
  onAccept,
  onDecline,
}: {
  receivedRequests: ConnectionRequest[];
  sentRequests: ConnectionRequest[];
  workingUserId: string | null;
  onAccept: (request: ConnectionRequest) => void;
  onDecline: (request: ConnectionRequest) => void;
}) {
  return (
    <div className="contacts-section-group">
      <div className="section-header-row">
        <div className="section-title">
          <UserPlus size={16} className="text-accent" />
          <h3>Connection Requests</h3>
          <span className="count-badge">{receivedRequests.length}</span>
        </div>
      </div>
      {receivedRequests.length === 0 ? (
        <div className="contacts-empty-subcard">
          <p>You do not have any connection requests right now.</p>
        </div>
      ) : (
        <div className="contacts-cards-grid">
          {receivedRequests.map((request) => (
            <div key={request.id} className="contact-person-card directory-card">
              <div className="card-top">
                <div className="contact-avatar-box">
                  <img
                    src={getSafeAvatar(request.avatar, request.displayName)}
                    alt={request.displayName}
                    className="contact-large-avatar"
                  />
                </div>
                <div className="contact-details">
                  <h4 className="contact-name">{request.displayName}</h4>
                  <span className="contact-role">@{request.username}</span>
                  <p className="contact-bio">{request.bio || "Would like to connect with you."}</p>
                </div>
              </div>
              <div className="contact-card-actions">
                <button
                  type="button"
                  className="contact-action-btn primary-start-chat-btn"
                  onClick={() => onAccept(request)}
                  disabled={workingUserId === request.userId}
                >
                  <Check size={14} />
                  <span>{workingUserId === request.userId ? "Working..." : "Accept"}</span>
                </button>
                <button
                  type="button"
                  className="contact-action-btn"
                  onClick={() => onDecline(request)}
                  disabled={workingUserId === request.userId}
                >
                  <X size={14} />
                  <span>Decline</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      {sentRequests.length > 0 && (
        <>
          <div className="section-header-row">
            <div className="section-title">
              <UserPlus size={16} />
              <h3>Requests Sent</h3>
              <span className="count-badge">{sentRequests.length}</span>
            </div>
          </div>
          <div className="contacts-cards-grid">
            {sentRequests.map((request) => (
              <div key={request.id} className="contact-person-card directory-card">
                <div className="card-top">
                  <div className="contact-avatar-box">
                    <img
                      src={getSafeAvatar(request.avatar, request.displayName)}
                      alt={request.displayName}
                      className="contact-large-avatar"
                    />
                  </div>
                  <div className="contact-details">
                    <h4 className="contact-name">{request.displayName}</h4>
                    <span className="contact-role">@{request.username}</span>
                    <p className="contact-bio">Waiting for them to accept your request.</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function BlockedContactsPanel({
  blockedUsers,
  workingUserId,
  onUnblock,
}: {
  blockedUsers: User[];
  workingUserId: string | null;
  onUnblock: (user: User) => void;
}) {
  return (
    <div className="contacts-section-group">
      <div className="section-header-row">
        <div className="section-title">
          <Shield size={16} className="text-accent" />
          <h3>Blocked Contacts</h3>
          <span className="count-badge">{blockedUsers.length}</span>
        </div>
      </div>
      {blockedUsers.length === 0 ? (
        <div className="contacts-empty-subcard">
          <p>You have not blocked any contacts.</p>
        </div>
      ) : (
        <div className="contacts-cards-grid">
          {blockedUsers.map((user) => (
            <div key={user.id} className="contact-person-card directory-card">
              <div className="card-top">
                <div className="contact-avatar-box">
                  <img
                    src={getSafeAvatar(user.avatar, user.displayName)}
                    alt={user.displayName}
                    className="contact-large-avatar"
                  />
                </div>
                <div className="contact-details">
                  <h4 className="contact-name">{user.displayName}</h4>
                  <span className="contact-role">@{user.username}</span>
                  <p className="contact-bio">Blocked contact</p>
                </div>
              </div>
              <div className="contact-card-actions">
                <button
                  type="button"
                  className="contact-action-btn"
                  onClick={() => onUnblock(user)}
                  disabled={workingUserId === user.id}
                >
                  <ShieldCheck size={14} />
                  <span>{workingUserId === user.id ? "Working..." : "Unblock"}</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const DEFAULT_COMMUNITIES: CommunityItem[] = [
  {
    id: "comm-general",
    name: "ConnectSphere Lounge",
    description: "Global open community for team members, collaboration, and general discussions.",
    memberCount: 24,
    channels: [
      { name: "announcements", desc: "Official updates, releases and system alerts" },
      { name: "general", desc: "Open conversations & daily discussions" },
      { name: "feedback", desc: "Feature suggestions & UI feedback" },
    ],
  },
  {
    id: "comm-design",
    name: "Design & Product Studio",
    description: "Design systems, UI/UX critiques, prototype reviews and product visual assets.",
    memberCount: 16,
    channels: [
      { name: "ui-critiques", desc: "Design reviews and wireframes" },
      { name: "figma-assets", desc: "Components and icon systems" },
    ],
  },
  {
    id: "comm-dev",
    name: "Engineering & WebRTC",
    description: "Real-time protocol discussions, media server architecture and API developments.",
    memberCount: 19,
    channels: [
      { name: "backend-core", desc: "PostgreSQL, API & session gateways" },
      { name: "webrtc-stream", desc: "Video, audio and collaborative canvas" },
    ],
  },
];

export function ContactsView({
  conversations,
  onStartChat,
  onStartCall,
  currentUser,
  onAddConversation,
}: ContactsViewProps) {
  const [activeTab, setActiveTab] = useState<"contacts" | "requests" | "blocked" | "communities">("contacts");
  const [search, setSearch] = useState("");
  const [showAddModal, setShowAddModal] = useState(false);
  const [showGroupModal, setShowGroupModal] = useState(false);
  const [newUsername, setNewUsername] = useState("");
  const [newCommunityName, setNewCommunityName] = useState("");
  const [newCommunityDesc, setNewCommunityDesc] = useState("");
  const [inviteStatus, setInviteStatus] = useState<InviteShareResult | null>(null);
  const [manualInviteUrl, setManualInviteUrl] = useState<string | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [communities, setCommunities] = useState<CommunityItem[]>(DEFAULT_COMMUNITIES);
  const [registeredUsers, setRegisteredUsers] = useState<User[]>([]);
  const [connections, setConnections] = useState<User[]>([]);
  const [receivedRequests, setReceivedRequests] = useState<ConnectionRequest[]>([]);
  const [sentRequests, setSentRequests] = useState<ConnectionRequest[]>([]);
  const [blockedUsers, setBlockedUsers] = useState<User[]>([]);
  const [connectionsLoaded, setConnectionsLoaded] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [workingUserId, setWorkingUserId] = useState<string | null>(null);
  const [selectedContactId, setSelectedContactId] = useState<string | null>(null);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

  const refreshConnectionData = useCallback(async () => {
    try {
      const response = await fetch("/api/connections");
      const result = await response.json() as {
        connections?: User[];
        requestsReceived?: ConnectionRequest[];
        requestsSent?: ConnectionRequest[];
        blockedUsers?: User[];
        error?: { message?: string };
      };
      if (!response.ok) throw new Error(result.error?.message || "Could not load connections.");
      setConnections(result.connections ?? []);
      setReceivedRequests(result.requestsReceived ?? []);
      setSentRequests(result.requestsSent ?? []);
      setBlockedUsers(result.blockedUsers ?? []);
      setConnectionsLoaded(true);
      setConnectionError(null);
    } catch (error) {
      setConnectionError(error instanceof Error ? error.message : "Could not load connections.");
      setConnectionsLoaded(true);
    }
  }, []);

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
      .catch(() => setConnectionError("Could not load the member directory."));
  }, [currentUser.id, currentUser.email]);

  useEffect(() => {
    void refreshConnectionData();
    const timer = window.setInterval(() => void refreshConnectionData(), 15_000);
    return () => window.clearInterval(timer);
  }, [refreshConnectionData]);

  const connectionIds = new Set(connections.map((user) => user.id));
  const receivedUserIds = new Set(receivedRequests.map((request) => request.userId));
  const sentUserIds = new Set(sentRequests.map((request) => request.userId));
  const blockedUserIds = new Set(blockedUsers.map((user) => user.id));
  const directContacts = conversations.filter((conversation) =>
    conversation.type === "direct" &&
    (!connectionsLoaded || Boolean(conversation.peerUserId && connectionIds.has(conversation.peerUserId)))
  );
  const filteredContacts = directContacts.filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    (c.description && c.description.toLowerCase().includes(search.toLowerCase()))
  );

  // Discoverable users: registered members who don't have a direct conversation yet
  const discoverableUsers = registeredUsers.filter((u) => {
    const alreadyConnected = directContacts.some(
      (c) => (u.id && c.peerUserId === u.id) || (u.email && c.peerEmail === u.email) || (u.displayName && c.name.toLowerCase() === u.displayName.toLowerCase())
    ) || connectionIds.has(u.id);
    if (alreadyConnected || receivedUserIds.has(u.id) || blockedUserIds.has(u.id)) return false;
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      u.displayName.toLowerCase().includes(q) ||
      u.username.toLowerCase().includes(q) ||
      (u.email && u.email.toLowerCase().includes(q))
    );
  });

  // Set default selection if none selected
  useEffect(() => {
    if (!selectedContactId && !selectedUserId) {
      if (filteredContacts.length > 0) {
        setSelectedContactId(filteredContacts[0]!.id);
      } else if (discoverableUsers.length > 0) {
        setSelectedUserId(discoverableUsers[0]!.id);
      }
    }
  }, [filteredContacts, discoverableUsers, selectedContactId, selectedUserId]);

  async function shareMyInviteLink() {
    setInviteStatus(null);
    setInviteError(null);
    setManualInviteUrl(null);

    try {
      const inviteUrl = createInviteLink(currentUser.username, window.location.origin);
      const result = await shareInviteUrl(inviteUrl);
      setInviteStatus(result === "cancelled" ? null : result);
      if (result === "manual") setManualInviteUrl(inviteUrl);
    } catch (error) {
      setInviteError(error instanceof Error ? error.message : "Could not create an invite link.");
    }
  }

  const [lookupError, setLookupError] = useState<string | null>(null);
  const [isLookingUp, setIsLookingUp] = useState(false);

  async function sendConnectionRequest(user: User) {
    setWorkingUserId(user.id);
    setConnectionError(null);
    try {
      const response = await fetch("/api/connections/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id }),
      });
      const result = await response.json() as { connected?: boolean; error?: { message?: string } };
      if (!response.ok) throw new Error(result.error?.message || "Could not send this connection request.");
      await refreshConnectionData();
      if (result.connected) await createConversationForUser(user);
    } catch (error) {
      setConnectionError(error instanceof Error ? error.message : "Could not send this connection request.");
    } finally {
      setWorkingUserId(null);
    }
  }

  async function createConversationForUser(user: User) {
    const newConv: Conversation = {
      id: "",
      type: "direct",
      name: user.displayName || user.username || user.email || "Member",
      avatar: getSafeAvatar(user.avatar, user.displayName),
      peerUserId: user.id,
      peerEmail: user.email,
      peerPhone: user.phone,
      isOnline: user.isOnline ?? false,
      unreadCount: 0,
      description: user.bio || (user.email ? `Email: ${user.email}` : "ConnectSphere Member"),
    };
    const created = await onAddConversation?.(newConv);
    if (created && created.id) {
      setSelectedContactId(created.id);
      setSelectedUserId(null);
      onStartChat(created.id);
    }
  }

  async function handleStartChatWithUser(u: User) {
    const existing = conversations.find(
      (c) =>
        (u.id && c.peerUserId === u.id) ||
        (u.email && c.peerEmail === u.email) ||
        (u.displayName && c.name.toLowerCase() === u.displayName.toLowerCase())
    );
    if (existing) {
      onStartChat(existing.id);
      setShowAddModal(false);
      setLookupError(null);
      return;
    }
    if (!connectionIds.has(u.id)) {
      await sendConnectionRequest(u);
      setShowAddModal(false);
      setLookupError(null);
      return;
    }
    await createConversationForUser(u);
    setShowAddModal(false);
    setLookupError(null);
  }

  async function handleAddContactSubmit() {
    if (!newUsername.trim()) return;
    const query = newUsername.trim();
    setLookupError(null);
    setIsLookingUp(true);

    try {
      const res = await fetch(`/api/auth/lookup?query=${encodeURIComponent(query)}`);
      const data = await res.json() as { exists?: boolean; user?: User; error?: { message?: string } };
      const foundUser = res.ok && data.exists ? data.user : null;

      if (foundUser) {
        await handleStartChatWithUser(foundUser);
        setNewUsername("");
        setShowAddModal(false);
      } else {
        setLookupError("No registered user matches that email or username. They must create an account before you can send a request.");
      }
    } catch (error) {
      setLookupError(error instanceof Error ? error.message : "Could not search for this contact.");
    } finally {
      setIsLookingUp(false);
    }
  }

  async function acceptConnectionRequest(request: ConnectionRequest) {
    setWorkingUserId(request.userId);
    setConnectionError(null);
    try {
      const response = await fetch(`/api/connections/requests/${encodeURIComponent(request.id)}/accept`, {
        method: "POST",
      });
      const result = await response.json() as { error?: { message?: string } };
      if (!response.ok) throw new Error(result.error?.message || "Could not accept this request.");
      await refreshConnectionData();
      await createConversationForUser({
        id: request.userId,
        username: request.username,
        displayName: request.displayName,
        avatar: request.avatar,
        email: request.email,
        phone: request.phone,
        bio: request.bio,
        profilePhotoProtection: request.profilePhotoProtection,
      });
    } catch (error) {
      setConnectionError(error instanceof Error ? error.message : "Could not accept this request.");
    } finally {
      setWorkingUserId(null);
    }
  }

  async function declineConnectionRequest(request: ConnectionRequest) {
    setWorkingUserId(request.userId);
    setConnectionError(null);
    try {
      const response = await fetch(`/api/connections/requests/${encodeURIComponent(request.id)}/decline`, {
        method: "POST",
      });
      const result = await response.json() as { error?: { message?: string } };
      if (!response.ok) throw new Error(result.error?.message || "Could not decline this request.");
      await refreshConnectionData();
    } catch (error) {
      setConnectionError(error instanceof Error ? error.message : "Could not decline this request.");
    } finally {
      setWorkingUserId(null);
    }
  }

  async function blockContact(user: User) {
    if (!window.confirm(`Block ${user.displayName}? They will no longer be able to chat or call you.`)) return;
    setWorkingUserId(user.id);
    setConnectionError(null);
    try {
      const response = await fetch(`/api/connections/blocked/${encodeURIComponent(user.id)}`, {
        method: "POST",
      });
      const result = await response.json() as { error?: { message?: string } };
      if (!response.ok) throw new Error(result.error?.message || "Could not block this contact.");
      await refreshConnectionData();
    } catch (error) {
      setConnectionError(error instanceof Error ? error.message : "Could not block this contact.");
    } finally {
      setWorkingUserId(null);
    }
  }

  async function unblockContact(user: User) {
    setWorkingUserId(user.id);
    setConnectionError(null);
    try {
      const response = await fetch(`/api/connections/blocked/${encodeURIComponent(user.id)}`, {
        method: "DELETE",
      });
      const result = await response.json() as { error?: { message?: string } };
      if (!response.ok) throw new Error(result.error?.message || "Could not unblock this contact.");
      await refreshConnectionData();
    } catch (error) {
      setConnectionError(error instanceof Error ? error.message : "Could not unblock this contact.");
    } finally {
      setWorkingUserId(null);
    }
  }

  async function handleCreateCommunity() {
    if (!newCommunityName.trim()) return;
    const name = newCommunityName.trim();
    const desc = newCommunityDesc.trim() || "Community group";
    const newComm: CommunityItem = {
      id: `comm-${Date.now()}`,
      name,
      description: desc,
      memberCount: 1,
      channels: [{ name: "general", desc: "General open discussions" }],
    };
    setCommunities((prev) => [...prev, newComm]);

    const channelConv: Conversation = {
      id: "",
      type: "community-channel",
      name: `${name} #general`,
      avatar: "/avatars/robot.png",
      isOnline: true,
      lastSeen: "Active space",
      unreadCount: 0,
      description: desc,
    };
    await onAddConversation?.(channelConv);
    setShowGroupModal(false);
    setNewCommunityName("");
    setNewCommunityDesc("");
  }

  // Active selected contact or user for preview
  const activeSelectedContact = selectedContactId
    ? conversations.find((c) => c.id === selectedContactId)
    : null;
  const activeSelectedContactUser = activeSelectedContact?.peerUserId
    ? connections.find((user) => user.id === activeSelectedContact.peerUserId)
    : undefined;
  const activeSelectedUser = selectedUserId
    ? registeredUsers.find((u) => u.id === selectedUserId)
    : null;

  return (
    <div className="contacts-page-layout">
      {/* Top Header Dock */}
      <div className="contacts-header-dock">
        <div className="contacts-title-area">
          <div className="contacts-title-row">
            <h2>Contacts &amp; Communities</h2>
            <span className="live-status-pill">
              <span className="live-dot" /> Live Directory
            </span>
          </div>
          <p className="subtitle-text">Connect with teammates, friends, and shared spaces across ConnectSphere</p>
        </div>

        <div className="contacts-actions-row">
          <div className="filter-pills-row">
            <button
              type="button"
              className={`filter-pill ${activeTab === "contacts" ? "is-active" : ""}`}
              onClick={() => setActiveTab("contacts")}
            >
              <Users size={14} />
              <span>Contacts ({directContacts.length})</span>
            </button>
            <button
              type="button"
              className={`filter-pill ${activeTab === "requests" ? "is-active" : ""}`}
              onClick={() => setActiveTab("requests")}
            >
              <UserPlus size={14} />
              <span>Requests ({receivedRequests.length})</span>
            </button>
            <button
              type="button"
              className={`filter-pill ${activeTab === "blocked" ? "is-active" : ""}`}
              onClick={() => setActiveTab("blocked")}
            >
              <Shield size={14} />
              <span>Blocked ({blockedUsers.length})</span>
            </button>
            <button
              type="button"
              className={`filter-pill ${activeTab === "communities" ? "is-active" : ""}`}
              onClick={() => setActiveTab("communities")}
            >
              <Compass size={14} />
              <span>Communities ({communities.length})</span>
            </button>
          </div>

          <div className="contacts-btn-group">
            <button
              type="button"
              className="secondary-btn invite-btn"
              onClick={shareMyInviteLink}
              title="Share your invite link"
            >
              {inviteStatus === "copied" ? <Check size={15} className="text-success" /> : <Link size={15} />}
              <span>{inviteStatus === "copied" ? "Link Copied" : inviteStatus === "shared" ? "Shared" : "Invite Link"}</span>
            </button>
            {activeTab === "contacts" ? (
              <button
                type="button"
                className="primary-action-btn"
                onClick={() => setShowAddModal(true)}
              >
                <UserPlus size={16} /> Add Contact
              </button>
            ) : activeTab === "communities" ? (
              <button
                type="button"
                className="primary-action-btn"
                onClick={() => setShowGroupModal(true)}
              >
                <Plus size={16} /> New Community
              </button>
            ) : (
              <button
                type="button"
                className="primary-action-btn"
                onClick={() => void refreshConnectionData()}
              >
                <RefreshCw size={15} /> Refresh
              </button>
            )}
          </div>
        </div>
      </div>

      {(inviteStatus === "copied" || inviteStatus === "shared") && (
        <div className="invite-link-feedback" role="status">
          <Check size={15} />
          <span>{inviteStatus === "copied" ? "Invite link copied." : "Invite link shared."}</span>
        </div>
      )}
      {inviteError && (
        <div className="invite-link-feedback is-error" role="alert">
          {inviteError}
        </div>
      )}
      {connectionError && (
        <div className="invite-link-feedback is-error" role="alert">
          {connectionError}
        </div>
      )}

      {/* Main Master-Detail 2-Column Layout */}
      <div className="contacts-master-detail-container">
        {/* Left Column: Contact Cards & Discover Directory */}
        <div className="contacts-main-list-column">
          {/* Search bar */}
          <div className="contacts-search-box">
            <Search size={16} className="search-icon" />
            <input
              type="text"
              placeholder="Search contacts"
              aria-label="Search contacts by name, username, or email"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="contacts-search-input"
            />
            {search && (
              <button
                type="button"
                className="search-clear-btn"
                onClick={() => setSearch("")}
                aria-label="Clear contact search"
                title="Clear search"
              >
                <X size={14} />
              </button>
            )}
          </div>

          {activeTab === "contacts" ? (
            <>
              {/* Section 1: My Active Direct Contacts */}
              <div className="contacts-section-group">
                <div className="section-header-row">
                  <div className="section-title">
                    <Users size={16} className="text-accent" />
                    <h3>My Direct Contacts</h3>
                    <span className="count-badge">{filteredContacts.length}</span>
                  </div>
                </div>

                {filteredContacts.length === 0 ? (
                  <div className="contacts-empty-subcard">
                    <p>No direct conversations match your search.</p>
                    <button
                      type="button"
                      className="add-contact-link"
                      onClick={() => setShowAddModal(true)}
                    >
                      + Add New Contact
                    </button>
                  </div>
                ) : (
                  <div className="contacts-cards-grid">
                    {filteredContacts.map((contact) => {
                      const isSelected = selectedContactId === contact.id;
                      return (
                        <div
                          key={contact.id}
                          className={`contact-person-card ${isSelected ? "is-selected" : ""}`}
                          onClick={() => {
                            setSelectedContactId(contact.id);
                            setSelectedUserId(null);
                          }}
                        >
                          <div className="card-top">
                            <div className="contact-avatar-box">
                              <img src={getSafeAvatar(contact.avatar, contact.name)} alt={contact.name} className="contact-large-avatar" />
                              <span className={`contact-status-dot ${contact.isOnline ? "is-online" : "is-offline"}`} />
                            </div>

                            <div className="contact-details">
                              <h4 className="contact-name">{contact.name}</h4>
                              <span className="contact-role">
                                {contact.isOnline ? "Online now" : formatLastSeen(contact.lastSeen)}
                              </span>
                              <p className="contact-bio">{contact.description ?? "ConnectSphere user"}</p>
                            </div>
                          </div>

                          <div className="contact-card-actions" onClick={(e) => e.stopPropagation()}>
                            <button
                              type="button"
                              className="contact-action-btn chat-btn"
                              onClick={() => onStartChat(contact.id)}
                              title="Send Message"
                            >
                              <MessageSquare size={14} /> <span>Chat</span>
                            </button>
                            <button
                              type="button"
                              className="contact-action-btn call-btn"
                              onClick={() => onStartCall(contact.name, getSafeAvatar(contact.avatar, contact.name), false, contact.peerUserId, contact.peerPhone)}
                              title="Voice Call"
                            >
                              <Phone size={14} /> <span>Voice</span>
                            </button>
                            <button
                              type="button"
                              className="contact-action-btn video-btn"
                              onClick={() => onStartCall(contact.name, getSafeAvatar(contact.avatar, contact.name), true, contact.peerUserId, contact.peerPhone)}
                              title="Video Call"
                            >
                              <Video size={14} /> <span>Video</span>
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Section 2: Explore ConnectSphere Directory */}
              {discoverableUsers.length > 0 && (
                <div className="contacts-section-group directory-section">
                  <div className="section-header-row">
                    <div className="section-title">
                      <Sparkles size={16} className="text-accent" />
                      <h3>ConnectSphere Directory</h3>
                      <span className="count-badge">{discoverableUsers.length}</span>
                    </div>
                    <span className="section-hint">Send a request before chatting or calling</span>
                  </div>

                  <div className="contacts-cards-grid">
                    {discoverableUsers.map((u) => {
                      const isSelected = selectedUserId === u.id;
                      return (
                        <div
                          key={u.id}
                          className={`contact-person-card directory-card ${isSelected ? "is-selected" : ""}`}
                          onClick={() => {
                            setSelectedUserId(u.id);
                            setSelectedContactId(null);
                          }}
                        >
                          <div className="card-top">
                            <div className="contact-avatar-box">
                              <img
                                src={getSafeAvatar(u.avatar, u.displayName)}
                                alt={u.displayName}
                                className="contact-large-avatar"
                              />
                              <span className="contact-status-dot is-online" />
                            </div>

                            <div className="contact-details">
                              <h4 className="contact-name">{u.displayName}</h4>
                              <span className="contact-role">@{u.username}</span>
                              <p className="contact-bio">{u.bio || "ConnectSphere member"}</p>
                            </div>
                          </div>

                          <div className="contact-card-actions" onClick={(e) => e.stopPropagation()}>
                            <button
                              type="button"
                              className="contact-action-btn primary-start-chat-btn"
                              onClick={() => void sendConnectionRequest(u)}
                              disabled={workingUserId === u.id || sentUserIds.has(u.id)}
                              title={sentUserIds.has(u.id) ? "Connection request sent" : "Send connection request"}
                            >
                              <UserPlus size={14} />
                              <span>{workingUserId === u.id ? "Sending..." : sentUserIds.has(u.id) ? "Request Sent" : "Connect"}</span>
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          ) : activeTab === "requests" ? (
            <ConnectionRequestsPanel
              receivedRequests={receivedRequests}
              sentRequests={sentRequests}
              workingUserId={workingUserId}
              onAccept={(request) => void acceptConnectionRequest(request)}
              onDecline={(request) => void declineConnectionRequest(request)}
            />
          ) : activeTab === "blocked" ? (
            <BlockedContactsPanel
              blockedUsers={blockedUsers}
              workingUserId={workingUserId}
              onUnblock={(user) => void unblockContact(user)}
            />
          ) : (
            /* Communities Tab */
            <div className="communities-tab-content">
              <div className="section-header-row">
                <div className="section-title">
                  <Compass size={18} className="text-accent" />
                  <h3>Open Community Spaces</h3>
                  <span className="count-badge">{communities.length}</span>
                </div>
              </div>

              <div className="communities-cards-grid">
                {communities.map((comm) => (
                  <div key={comm.id} className="community-space-card">
                    <div className="community-card-header">
                      <div className="community-icon-box">
                        <Users size={22} className="text-accent" />
                      </div>
                      <div className="community-meta">
                        <h4 className="community-title">{comm.name}</h4>
                        <span className="community-members-pill">
                          <Users size={12} /> {comm.memberCount} members online
                        </span>
                      </div>
                    </div>

                    <p className="community-desc">{comm.description}</p>

                    <div className="community-channels-list">
                      <span className="channels-label">Channels in space:</span>
                      <div className="channels-tags-row">
                        {comm.channels.map((ch) => (
                          <div
                            key={ch.name}
                            className="channel-tag-pill"
                            onClick={() => {
                              const target = conversations.find(
                                (c) => c.type === "community-channel" && c.name.includes(comm.name)
                              ) ?? conversations[0];
                              if (target) onStartChat(target.id);
                            }}
                          >
                            <Hash size={13} className="text-accent" />
                            <span>{ch.name}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <button
                      type="button"
                      className="community-join-btn"
                      onClick={() => {
                        const target = conversations.find(
                          (c) => c.type === "community-channel" && c.name.includes(comm.name)
                        ) ?? conversations[0];
                        if (target) onStartChat(target.id);
                      }}
                    >
                      <MessageSquare size={14} />
                      <span>Enter Community Channels</span>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right Column: Contact Profile & Intelligence Inspector Panel */}
        <div className="contacts-preview-column">
          {activeSelectedContact ? (
            <div className="contact-inspector-card">
              <div className="inspector-header">
                <div className="inspector-avatar-wrap">
                  <img
                    src={getSafeAvatar(activeSelectedContact.avatar, activeSelectedContact.name)}
                    alt={activeSelectedContact.name}
                    className="inspector-large-avatar"
                  />
                  <span className={`inspector-status-dot ${activeSelectedContact.isOnline ? "is-online" : "is-offline"}`} />
                </div>
                <h3 className="inspector-name">{activeSelectedContact.name}</h3>
                <span className="inspector-status-pill">
                  {activeSelectedContact.isOnline ? "Online • Active now" : formatLastSeen(activeSelectedContact.lastSeen)}
                </span>
                <p className="inspector-bio">{activeSelectedContact.description || "ConnectSphere member"}</p>
              </div>

              {/* Action buttons */}
              <div className="inspector-actions-row">
                <button
                  type="button"
                  className="inspector-main-action-btn"
                  onClick={() => onStartChat(activeSelectedContact.id)}
                >
                  <MessageSquare size={16} />
                  <span>Send Message</span>
                </button>
                <div className="inspector-call-btns">
                  <button
                    type="button"
                    className="inspector-call-btn"
                    onClick={() => onStartCall(activeSelectedContact.name, getSafeAvatar(activeSelectedContact.avatar, activeSelectedContact.name), false, activeSelectedContact.peerUserId, activeSelectedContact.peerPhone)}
                    title="Start Voice Call"
                  >
                    <Phone size={16} />
                    <span>Voice</span>
                  </button>
                  <button
                    type="button"
                    className="inspector-call-btn"
                    onClick={() => onStartCall(activeSelectedContact.name, getSafeAvatar(activeSelectedContact.avatar, activeSelectedContact.name), true, activeSelectedContact.peerUserId, activeSelectedContact.peerPhone)}
                    title="Start Video Call"
                  >
                    <Video size={16} />
                    <span>Video</span>
                  </button>
                </div>
                {activeSelectedContactUser && (
                  <button
                    type="button"
                    className="contact-action-btn"
                    onClick={() => void blockContact(activeSelectedContactUser)}
                    disabled={workingUserId === activeSelectedContactUser.id}
                    title="Block this contact"
                  >
                    <Shield size={14} />
                    <span>Block</span>
                  </button>
                )}
              </div>

              {/* Security & Verification Card */}
              <div className="inspector-security-box">
                <div className="security-title-row">
                  <ShieldCheck size={18} className="text-accent" />
                  <strong>E2EE Verified Security</strong>
                </div>
                <p>Messages and calls with this contact are protected with end-to-end encryption (WebRTC DTLS-SRTP & AES-GCM).</p>
              </div>

              {/* Profile Details List */}
              <div className="inspector-details-list">
                <div className="inspector-detail-row">
                  <span className="detail-label">Status</span>
                  <span className="detail-value text-accent">{activeSelectedContact.isOnline ? "Available" : "Offline"}</span>
                </div>
                <div className="inspector-detail-row">
                  <span className="detail-label">Conversation Type</span>
                  <span className="detail-value">Direct 1:1 Encrypted</span>
                </div>
                <div className="inspector-detail-row">
                  <span className="detail-label">Session ID</span>
                  <span className="detail-value mono-text">{activeSelectedContact.id.slice(0, 12)}...</span>
                </div>
              </div>
            </div>
          ) : activeSelectedUser ? (
            <div className="contact-inspector-card">
              <div className="inspector-header">
                <div className="inspector-avatar-wrap">
                  <img
                    src={getSafeAvatar(activeSelectedUser.avatar, activeSelectedUser.displayName)}
                    alt={activeSelectedUser.displayName}
                    className="inspector-large-avatar"
                  />
                  <span className="inspector-status-dot is-online" />
                </div>
                <h3 className="inspector-name">{activeSelectedUser.displayName}</h3>
                <span className="inspector-handle">@{activeSelectedUser.username}</span>
                <span className="inspector-status-pill is-online">Registered Member</span>
                <p className="inspector-bio">{activeSelectedUser.bio || "ConnectSphere member"}</p>
              </div>

              {/* Action buttons */}
              <div className="inspector-actions-row">
                <button
                  type="button"
                  className="inspector-main-action-btn"
                  onClick={() => void sendConnectionRequest(activeSelectedUser)}
                  disabled={workingUserId === activeSelectedUser.id || sentUserIds.has(activeSelectedUser.id)}
                >
                  <UserPlus size={16} />
                  <span>{sentUserIds.has(activeSelectedUser.id) ? "Request Sent" : "Send Connection Request"}</span>
                </button>
              </div>

              <div className="inspector-security-box">
                <div className="security-title-row">
                  <ShieldCheck size={18} className="text-accent" />
                  <strong>Platform Verified</strong>
                </div>
                <p>Accept a connection request before starting a direct chat or voice/video call.</p>
              </div>
            </div>
          ) : (
            <div className="contact-inspector-card empty-inspector">
              <div className="empty-inspector-icon">
                <Users size={32} />
              </div>
              <h4>Directory Overview</h4>
              <p>Select any contact or member from the directory to view detailed profile, encryption verification, and quick communication tools.</p>
              <div className="directory-stats-grid">
                <div className="stat-pill">
                  <span className="stat-number">{directContacts.length}</span>
                  <span className="stat-text">Active Contacts</span>
                </div>
                <div className="stat-pill">
                  <span className="stat-number">{registeredUsers.length + 1}</span>
                  <span className="stat-text">Total Members</span>
                </div>
              </div>
              <button type="button" className="invite-action-wide-btn" onClick={shareMyInviteLink}>
                <Link size={15} />
                <span>{inviteStatus === "copied" ? "Link Copied!" : inviteStatus === "shared" ? "Invite Shared" : "Share ConnectSphere Invite"}</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Add Contact Modal */}
      {showAddModal && (
        <div className="modal-backdrop" onClick={() => setShowAddModal(false)}>
          <div className="modal-card enhanced-chat-modal" onClick={(e) => e.stopPropagation()}>
            <div className="new-chat-modal-header">
              <div className="new-chat-header-brand">
                <div className="new-chat-header-icon-wrap">
                  <UserPlus size={20} />
                </div>
                <div>
                  <h3 className="new-chat-title">Add New Contact</h3>
                  <p className="new-chat-subtitle">Search registered contacts or add by email or username</p>
                </div>
              </div>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => {
                  setShowAddModal(false);
                  setLookupError(null);
                }}
                aria-label="Close dialog"
              >
                <X size={18} />
              </button>
            </div>

            <div className="modal-body enhanced-modal-body">
              {registeredUsers.length > 0 && (
                <div className="registered-users-section">
                  <div className="registered-users-header">
                    <Sparkles size={13} className="text-accent" />
                    <span>Registered on ConnectSphere ({registeredUsers.length})</span>
                  </div>
                  <div className="registered-users-list">
                    {registeredUsers.map((u) => (
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
                            <span className="user-handle">{u.email || `@${u.username}`}</span>
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
                </div>
              )}

              <div className="field-group">
                <label className="field-label">
                  {registeredUsers.length > 0 ? "Or Enter Email, Username, or Name" : "Contact Email, Username, or Name"}
                </label>
                <div className="enhanced-input-wrapper">
                  <div className="input-leading-icon">
                    <Search size={17} />
                  </div>
                  <input
                    type="text"
                    className="enhanced-text-field"
                    placeholder="e.g. alex@example.com or Alex"
                    value={newUsername}
                    onChange={(e) => {
                      setNewUsername(e.target.value);
                      if (lookupError) setLookupError(null);
                    }}
                    autoFocus
                  />
                </div>
              </div>

              {lookupError && (
                <div className="wa-error-banner lookup-error-banner">
                  <div className="error-text-row">
                    <AlertCircle size={17} className="error-icon" />
                    <span>{lookupError}</span>
                  </div>
                  <button
                    type="button"
                    className="invite-link-btn"
                    onClick={shareMyInviteLink}
                  >
                    Share Invite Link
                  </button>
                </div>
              )}

              <div className="modal-encryption-tag">
                <ShieldCheck size={14} className="text-accent" />
                <span>Conversations are private and encrypted.</span>
              </div>

              <div className="modal-footer-btns">
                <button
                  type="button"
                  className="secondary-btn"
                  onClick={() => {
                    setShowAddModal(false);
                    setLookupError(null);
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="primary-action-btn enhanced-start-btn"
                  onClick={handleAddContactSubmit}
                  disabled={!newUsername.trim() || isLookingUp}
                >
                  {isLookingUp ? (
                    <>
                      <RefreshCw size={15} className="spin-icon" />
                      <span>Verifying...</span>
                    </>
                  ) : (
                    <>
                      <ArrowRight size={16} />
                      <span>Add Contact &amp; Chat</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* New Community Modal */}
      {showGroupModal && (
        <div className="modal-backdrop" onClick={() => setShowGroupModal(false)}>
          <div className="modal-card enhanced-chat-modal" onClick={(e) => e.stopPropagation()}>
            <div className="new-chat-modal-header">
              <div className="new-chat-header-brand">
                <div className="new-chat-header-icon-wrap">
                  <Compass size={20} />
                </div>
                <div>
                  <h3 className="new-chat-title">Create Community Space</h3>
                  <p className="new-chat-subtitle">Start a multi-channel collaboration hub for your team</p>
                </div>
              </div>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setShowGroupModal(false)}
                aria-label="Close dialog"
              >
                <X size={18} />
              </button>
            </div>

            <div className="modal-body enhanced-modal-body">
              <div className="field-group">
                <label className="field-label">Community Name</label>
                <input
                  type="text"
                  className="enhanced-text-field"
                  placeholder="e.g. Design Studio or Core Engineering"
                  value={newCommunityName}
                  onChange={(e) => setNewCommunityName(e.target.value)}
                  autoFocus
                />
              </div>

              <div className="field-group">
                <label className="field-label">Description &amp; Purpose</label>
                <textarea
                  className="enhanced-text-field"
                  rows={3}
                  placeholder="What is this community space about?"
                  value={newCommunityDesc}
                  onChange={(e) => setNewCommunityDesc(e.target.value)}
                />
              </div>

              <div className="modal-footer-btns">
                <button
                  type="button"
                  className="secondary-btn"
                  onClick={() => setShowGroupModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="primary-action-btn enhanced-start-btn"
                  onClick={handleCreateCommunity}
                  disabled={!newCommunityName.trim()}
                >
                  <Plus size={16} />
                  <span>Create Community</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {manualInviteUrl && (
        <InviteLinkManualCopy
          url={manualInviteUrl}
          onClose={() => {
            setManualInviteUrl(null);
            setInviteStatus(null);
          }}
        />
      )}
    </div>
  );
}
