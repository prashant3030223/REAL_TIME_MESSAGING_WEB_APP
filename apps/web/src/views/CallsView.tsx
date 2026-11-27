import { useState, useEffect } from "react";
import {
  Phone,
  Video,
  PhoneIncoming,
  PhoneOutgoing,
  PhoneMissed,
  PhoneOff,
  Calendar,
  Plus,
  Trash2,
  Search,
  ShieldCheck,
  Zap,
  Users,
  X,
  Sparkles,
} from "lucide-react";
import type { CallRecord, Conversation, User } from "../services/types.js";
import { getSafeAvatar } from "../services/avatars.js";
import { formatCallTimestamp } from "../services/time.js";

type CallsViewProps = {
  callHistory: CallRecord[];
  onStartCall: (
    peerName: string,
    peerAvatar: string,
    isVideo: boolean,
    targetUserId?: string,
    targetPhone?: string
  ) => void;
  onDeleteCallRecord: (recordId: string) => void;
  onClearCallHistory: () => void;
  currentUser?: User;
  conversations?: Conversation[];
};

export function CallsView({
  callHistory,
  onStartCall,
  onDeleteCallRecord,
  onClearCallHistory,
  currentUser,
  conversations = [],
}: CallsViewProps) {
  const [filter, setFilter] = useState<"all" | "missed">("all");
  const [searchCall, setSearchCall] = useState("");
  const [contactSearch, setContactSearch] = useState("");
  const [registeredUsers, setRegisteredUsers] = useState<User[]>([]);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [scheduleTitle, setScheduleTitle] = useState("");
  const [scheduleDateTime, setScheduleDateTime] = useState("");
  const [scheduledCalls, setScheduledCalls] = useState<
    Array<{ id: string; title: string; time: string; isVideo: boolean }>
  >([]);

  // Fetch registered users for direct 1-click calling
  useEffect(() => {
    fetch("/api/auth/users")
      .then((res) => res.json())
      .then((data) => {
        if (data?.users && Array.isArray(data.users)) {
          const others = data.users.filter(
            (u: User) => !currentUser || (u.id !== currentUser.id && (!currentUser.email || u.email !== currentUser.email))
          );
          setRegisteredUsers(others);
        }
      })
      .catch(() => { });
  }, [currentUser?.id, currentUser?.email]);

  function handleScheduleSubmit() {
    if (!scheduleTitle || !scheduleDateTime) return;
    setScheduledCalls((prev) => [
      ...prev,
      {
        id: `sc-${Date.now()}`,
        title: scheduleTitle,
        time: scheduleDateTime,
        isVideo: true,
      },
    ]);
    setShowScheduleModal(false);
    setScheduleTitle("");
    setScheduleDateTime("");
  }

  const filteredHistory = callHistory.filter((c) => {
    if (filter === "missed" && c.direction !== "missed") return false;
    if (searchCall.trim() && !c.peerName.toLowerCase().includes(searchCall.toLowerCase())) return false;
    return true;
  });

  const totalDurationSec = callHistory.reduce((acc, c) => acc + c.durationSec, 0);
  const totalMinutes = Math.round(totalDurationSec / 60);

  // Extract recent unique callers for quick speed-dial chips
  const recentPeers = Array.from(
    new Map(callHistory.map((c) => [c.peerName, c])).values()
  ).slice(0, 4);

  // Filter registered contacts to call
  const connectedUserIds = new Set(
    conversations
      .filter((conversation) => conversation.type === "direct" && conversation.peerUserId)
      .map((conversation) => conversation.peerUserId!),
  );
  const filteredContactsToCall = registeredUsers.filter((u) => {
    if (!connectedUserIds.has(u.id)) return false;
    if (!contactSearch.trim()) return true;
    const q = contactSearch.toLowerCase();
    return (
      u.displayName.toLowerCase().includes(q) ||
      u.username.toLowerCase().includes(q) ||
      (u.email && u.email.toLowerCase().includes(q))
    );
  });

  const formatDuration = (seconds: number) => {
    if (seconds === 0) return "Not connected";
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}m ${secs < 10 ? "0" : ""}${secs}s`;
  };

  return (
    <div className="calls-page-layout">
      {/* Top Call Stats & Engine KPI Bar */}
      <div className="calls-kpi-bar" role="region" aria-label="Call statistics">
        <div className="kpi-card">
          <span className="kpi-label">Total Calls</span>
          <span className="kpi-value">{callHistory.length}</span>
        </div>
        <div className="kpi-card">
          <span className="kpi-label">Talk Time</span>
          <span className="kpi-value">{totalMinutes}m</span>
        </div>
        <div className="kpi-card">
          <span className="kpi-label">Missed Calls</span>
          <span className={`kpi-value ${callHistory.some((c) => c.direction === "missed") ? "text-danger" : ""}`}>
            {callHistory.filter((c) => c.direction === "missed").length}
          </span>
        </div>
        <div className="kpi-card is-engine">
          <span className="kpi-label">Call Recovery Mesh</span>
          <span className="kpi-value text-accent">Active · WebRTC HD</span>
        </div>
      </div>

      <div className="calls-dashboard-columns">
        {/* Left Pane: Call History Logs & Scheduled Meetings */}
        <div className="calls-history-pane">
          <div className="calls-pane-header">
            <div>
              <h2>Call History</h2>
              <p className="subtitle-text">Voice, video &amp; conference logs</p>
            </div>

            <div className="calls-history-controls">
              <div className="calls-filter-tabs" role="group" aria-label="Filter call history">
                <button
                  type="button"
                  className={`filter-pill ${filter === "all" ? "is-active" : ""}`}
                  aria-pressed={filter === "all"}
                  onClick={() => setFilter("all")}
                >
                  All ({callHistory.length})
                </button>
                <button
                  type="button"
                  className={`filter-pill ${filter === "missed" ? "is-active" : ""}`}
                  aria-pressed={filter === "missed"}
                  onClick={() => setFilter("missed")}
                >
                  Missed ({callHistory.filter((c) => c.direction === "missed").length})
                </button>
              </div>
              {callHistory.length > 0 && (
                <button
                  type="button"
                  className="clear-call-history-btn"
                  onClick={() => {
                    if (window.confirm("Delete all call history from this device?")) onClearCallHistory();
                  }}
                >
                  <Trash2 size={13} /> Clear
                </button>
              )}
            </div>
          </div>

          {/* Scheduled Calls Card */}
          <div className="scheduled-calls-card">
            <div className="scheduled-card-header">
              <div className="title-row">
                <Calendar size={15} className="text-accent" />
                <strong>Upcoming Conference Calls</strong>
              </div>
              <button
                type="button"
                className="quick-add-btn"
                onClick={() => setShowScheduleModal(true)}
                title="Schedule a call"
              >
                <Plus size={13} /> Schedule
              </button>
            </div>
            <div className="scheduled-items-list">
              {scheduledCalls.length === 0 ? (
                <p className="empty-subtext">No upcoming calls scheduled. Tap Schedule to set a call reminder.</p>
              ) : (
                scheduledCalls.map((item) => (
                  <div key={item.id} className="scheduled-item">
                    <div className="scheduled-item-info">
                      <span className="scheduled-item-title">{item.title}</span>
                      <span className="scheduled-item-time">{item.time}</span>
                    </div>
                    <button
                      type="button"
                      className="scheduled-join-btn"
                      onClick={() =>
                        onStartCall(
                          item.title,
                          getSafeAvatar(undefined, item.title),
                          item.isVideo
                        )
                      }
                    >
                      {item.isVideo ? <Video size={13} /> : <Phone size={13} />} Join
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Call History Search */}
          {callHistory.length > 0 && (
            <div className="call-history-search-row">
              <div className="search-input-wrap">
                <Search size={14} className="search-icon" />
                <input
                  type="text"
                  placeholder="Filter call history by name..."
                  aria-label="Filter call history by name"
                  value={searchCall}
                  onChange={(e) => setSearchCall(e.target.value)}
                  className="call-search-input"
                />
                {searchCall && (
                  <button
                    type="button"
                    className="clear-search-btn"
                    onClick={() => setSearchCall("")}
                    aria-label="Clear call history search"
                    title="Clear search"
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Call Log Records */}
          <div className="call-records-list">
            {filteredHistory.length === 0 ? (
              <div className="empty-call-history-state">
                <div className="empty-conv-icon-circle">
                  <Phone size={28} />
                </div>
                <h3>{filter === "missed" ? "No missed calls" : "No call history yet"}</h3>
                <p>
                  {filter === "missed"
                    ? "Missed calls will appear here so you can easily call back."
                    : "Start a voice or video call with any contact from the directory on the right."}
                </p>
              </div>
            ) : (
              filteredHistory.map((call) => {
                const safeAvatar = getSafeAvatar(call.peerAvatar, call.peerName);
                return (
                  <div key={call.id} className="call-record-card">
                    <div className="call-avatar-wrap">
                      <img src={safeAvatar} alt={call.peerName} className="call-avatar-img" />
                      <span className="call-direction-badge">
                        {call.direction === "incoming" && <PhoneIncoming size={12} className="text-success" />}
                        {call.direction === "outgoing" && <PhoneOutgoing size={12} className="text-accent" />}
                        {call.direction === "missed" && <PhoneMissed size={12} className="text-danger" />}
                        {call.direction === "declined" && <PhoneOff size={12} className="text-muted" />}
                      </span>
                    </div>

                    <div className="call-info">
                      <h4 className="call-peer-name">{call.peerName}</h4>
                      <div className="call-meta-row">
                        <span className="call-type-tag">
                          {call.type === "video" ? <Video size={12} /> : <Phone size={12} />}
                          {call.type === "video" ? "Video" : "Voice"}
                        </span>
                        <span className="meta-sep">·</span>
                        <span className="call-timestamp">{formatCallTimestamp(call.timestamp)}</span>
                        <span className="meta-sep">·</span>
                        <span className="call-duration-text">{formatDuration(call.durationSec)}</span>
                      </div>
                    </div>

                    <div className="call-quick-actions">
                      <button
                        type="button"
                        className="call-btn-circle"
                        onClick={() => onStartCall(call.peerName, safeAvatar, false, call.peerId)}
                        title="Call Back (Voice)"
                        aria-label={`Call ${call.peerName} by voice`}
                      >
                        <Phone size={15} />
                      </button>
                      <button
                        type="button"
                        className="call-btn-circle is-video"
                        onClick={() => onStartCall(call.peerName, safeAvatar, true, call.peerId)}
                        title="Call Back (Video)"
                        aria-label={`Call ${call.peerName} by video`}
                      >
                        <Video size={15} />
                      </button>
                      <button
                        type="button"
                        className="call-btn-circle call-delete-btn"
                        onClick={() => onDeleteCallRecord(call.id)}
                        aria-label={`Delete call with ${call.peerName}`}
                        title="Delete call record"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right Pane: Direct Contact Calling Directory & WebRTC Mesh Info (NO Numeric Dialpad) */}
        <div className="calls-directory-pane">
          <div className="calls-directory-card">
            <div className="calls-directory-header">
              <div className="header-title-group">
                <div className="header-icon-badge">
                  <Phone size={18} className="text-accent" />
                </div>
                <div>
                  <h3>Direct Calling Directory</h3>
                  <p className="directory-sub">Instant 1-click HD Voice &amp; Video calls</p>
                </div>
              </div>
            </div>

            {/* Recent Callers Speed Dial Chips */}
            {recentPeers.length > 0 && (
              <div className="calls-speed-dial-section">
                <span className="speed-dial-label">Frequent Contacts</span>
                <div className="calls-speed-chips-grid">
                  {recentPeers.map((peer) => {
                    const safeAvatar = getSafeAvatar(peer.peerAvatar, peer.peerName);
                    return (
                      <button
                        key={`speed-${peer.id}`}
                        type="button"
                        className="calls-speed-chip"
                        onClick={() => onStartCall(peer.peerName, safeAvatar, peer.type === "video", peer.peerId)}
                        title={`Call ${peer.peerName}`}
                      >
                        <img src={safeAvatar} alt="" className="speed-chip-avatar" />
                        <span className="speed-chip-name">{peer.peerName.split(" ")[0]}</span>
                        {peer.type === "video" ? (
                          <Video size={12} className="text-accent" />
                        ) : (
                          <Phone size={12} className="text-success" />
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Contact Search Input */}
            <div className="calls-search-box">
              <div className="search-input-wrap">
                <Search size={15} className="search-icon" />
                <input
                  type="text"
                  placeholder="Search registered members to call..."
                  value={contactSearch}
                  onChange={(e) => setContactSearch(e.target.value)}
                  className="calls-member-search-input"
                />
                {contactSearch && (
                  <button type="button" className="clear-search-btn" onClick={() => setContactSearch("")}>
                    <X size={13} />
                  </button>
                )}
              </div>
            </div>

            {/* Registered Members List */}
            <div className="calls-members-list">
              <div className="calls-members-header">
                <Users size={14} className="text-accent" />
                <span>Available Contacts ({filteredContactsToCall.length})</span>
              </div>

              {filteredContactsToCall.length === 0 ? (
                <div className="calls-empty-members">
                  <p>
                    {contactSearch
                      ? `No contacts matching "${contactSearch}".`
                      : "No other registered members found yet."}
                  </p>
                </div>
              ) : (
                filteredContactsToCall.map((u) => {
                  const safeAvatar = getSafeAvatar(u.avatar, u.displayName);
                  return (
                    <div key={u.id} className="calls-member-row">
                      <div className="member-avatar-wrap">
                        <img src={safeAvatar} alt={u.displayName} className="member-avatar-img" />
                        <span className="member-online-dot" />
                      </div>
                      <div className="member-info">
                        <span className="member-name">{u.displayName}</span>
                        <span className="member-handle">@{u.username || u.email?.split("@")[0]}</span>
                      </div>
                      <div className="member-call-actions">
                        <button
                          type="button"
                          className="member-call-btn voice-btn"
                          onClick={() => onStartCall(u.displayName, safeAvatar, false, u.id)}
                          title={`Voice call ${u.displayName}`}
                        >
                          <Phone size={14} />
                          <span>Voice</span>
                        </button>
                        <button
                          type="button"
                          className="member-call-btn video-btn"
                          onClick={() => onStartCall(u.displayName, safeAvatar, true, u.id)}
                          title={`Video call ${u.displayName}`}
                        >
                          <Video size={14} />
                          <span>Video</span>
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* WebRTC HD Mesh Protocol Status Card */}
            <div className="calls-mesh-status-card">
              <div className="mesh-status-header">
                <ShieldCheck size={16} className="text-accent" />
                <span>WebRTC HD Protocol Specifications</span>
              </div>
              <div className="mesh-specs-grid">
                <div className="spec-item">
                  <span className="spec-label">Encryption</span>
                  <span className="spec-val">DTLS 1.3 · SRTP</span>
                </div>
                <div className="spec-item">
                  <span className="spec-label">Audio Codec</span>
                  <span className="spec-val">Opus 48kHz HD</span>
                </div>
                <div className="spec-item">
                  <span className="spec-label">Video Engine</span>
                  <span className="spec-val">VP9 / AV1 60 FPS</span>
                </div>
                <div className="spec-item">
                  <span className="spec-label">Recovery Mesh</span>
                  <span className="spec-val text-success">Active · Self-Healing</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Schedule Call Modal */}
      {showScheduleModal && (
        <div className="modal-backdrop" onClick={() => setShowScheduleModal(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Schedule a Conference Call</h3>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setShowScheduleModal(false)}
              >
                <X size={18} />
              </button>
            </div>
            <div className="modal-body">
              <label className="field-label">
                Meeting Title
                <input
                  type="text"
                  className="text-field"
                  placeholder="e.g. Weekly Team Standup"
                  value={scheduleTitle}
                  onChange={(e) => setScheduleTitle(e.target.value)}
                />
              </label>

              <label className="field-label">
                Date &amp; Time
                <input
                  type="datetime-local"
                  className="text-field"
                  value={scheduleDateTime}
                  onChange={(e) => setScheduleDateTime(e.target.value)}
                />
              </label>

              <div className="modal-footer-btns">
                <button
                  type="button"
                  className="secondary-btn"
                  onClick={() => setShowScheduleModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="primary-action-btn"
                  onClick={handleScheduleSubmit}
                  disabled={!scheduleTitle || !scheduleDateTime}
                >
                  Save Call Reminder
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
