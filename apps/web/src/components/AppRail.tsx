import {
  MessageSquare,
  Phone,
  Users,
  Compass,
  Settings,
  Lock,
} from "lucide-react";
import type { User } from "../services/types.js";
import { getSafeAvatar } from "../services/avatars.js";

export type NavTab = "chats" | "calls" | "contacts" | "workspace" | "settings";

type AppRailProps = {
  activeTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  currentUser: User;
  unreadCount: number;
  missedCallsCount: number;
  isOnline: boolean;
  onLockApp: () => void;
  onOpenProfile: () => void;
};

export function AppRail({
  activeTab,
  onSelectTab,
  currentUser,
  unreadCount,
  missedCallsCount,
  isOnline,
  onLockApp,
  onOpenProfile,
}: AppRailProps) {
  return (
    <aside className="app-rail" aria-label="Main Navigation">
      <div className="rail-top">
        <button
          type="button"
          className="brand-logo-btn"
          onClick={() => onSelectTab("chats")}
          title="ConnectSphere Home"
          aria-label="ConnectSphere Home"
        >
          <div className="brand-icon-wrapper">
            <img src="/icon.svg" alt="ConnectSphere" className="brand-logo-img" />
            <span
              className={`brand-pulse-dot ${isOnline ? "is-online" : "is-offline"}`}
              title={isOnline ? "Network: Online" : "Network: Offline"}
            />
          </div>
        </button>

        <nav className="rail-nav" aria-label="Sections">
          <button
            type="button"
            className={`rail-item ${activeTab === "chats" ? "is-active" : ""}`}
            onClick={() => onSelectTab("chats")}
            title="Messages & Chats"
            aria-label="Chats"
          >
            {activeTab === "chats" && <span className="rail-active-indicator" />}
            <MessageSquare size={20} strokeWidth={2} />
            <span className="rail-label">Chats</span>
            {unreadCount > 0 && <span className="rail-badge">{unreadCount}</span>}
          </button>

          <button
            type="button"
            className={`rail-item ${activeTab === "calls" ? "is-active" : ""}`}
            onClick={() => onSelectTab("calls")}
            title="Voice & Video Calls"
            aria-label="Calls"
          >
            {activeTab === "calls" && <span className="rail-active-indicator" />}
            <Phone size={20} strokeWidth={2} />
            <span className="rail-label">Calls</span>
            {missedCallsCount > 0 && <span className="rail-badge is-alert">{missedCallsCount}</span>}
          </button>

          <button
            type="button"
            className={`rail-item ${activeTab === "contacts" ? "is-active" : ""}`}
            onClick={() => onSelectTab("contacts")}
            title="Contacts & Communities"
            aria-label="Contacts"
          >
            {activeTab === "contacts" && <span className="rail-active-indicator" />}
            <Users size={20} strokeWidth={2} />
            <span className="rail-label">Contacts</span>
          </button>

          <button
            type="button"
            className={`rail-item ${activeTab === "workspace" ? "is-active" : ""}`}
            onClick={() => onSelectTab("workspace")}
            title="Collaborative Workspace"
            aria-label="Workspace"
          >
            {activeTab === "workspace" && <span className="rail-active-indicator" />}
            <Compass size={20} strokeWidth={2} />
            <span className="rail-label">Workspace</span>
          </button>

          <button
            type="button"
            className={`rail-item ${activeTab === "settings" ? "is-active" : ""}`}
            onClick={() => onSelectTab("settings")}
            title="Preferences & Profile"
            aria-label="Settings"
          >
            {activeTab === "settings" && <span className="rail-active-indicator" />}
            <Settings size={20} strokeWidth={2} />
            <span className="rail-label">Settings</span>
          </button>
        </nav>
      </div>

      <div className="rail-bottom">
        <button
          type="button"
          className="rail-action-btn"
          onClick={onLockApp}
          title="Lock ConnectSphere (App PIN)"
          aria-label="Lock App"
        >
          <Lock size={16} />
        </button>

        <button
          type="button"
          className="user-avatar-btn"
          onClick={onOpenProfile}
          title={`${currentUser.displayName} (${currentUser.username ? `@${currentUser.username}` : "Profile"})`}
          aria-label="My Profile"
        >
          <div className="rail-avatar-container">
            <img src={getSafeAvatar(currentUser.avatar, currentUser.displayName)} alt={currentUser.displayName} className="rail-avatar-img" />
            <span className={`user-online-pip ${isOnline ? "is-online" : "is-offline"}`} />
          </div>
        </button>
      </div>
    </aside>
  );
}
