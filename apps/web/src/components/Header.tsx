import { Video, QrCode, WifiOff, Wifi, Shield, Zap } from "lucide-react";
import type { NavTab } from "./AppRail.js";

type HeaderProps = {
  activeTab: NavTab;
  isOnline: boolean;
  onStartInstantCall: () => void;
  onOpenQrModal: () => void;
};

export function Header({ activeTab, isOnline, onStartInstantCall, onOpenQrModal }: HeaderProps) {
  const getTabMeta = () => {
    switch (activeTab) {
      case "chats":
        return {
          title: "Messages",
          badge: "E2E Encrypted",
          badgeIcon: <Shield size={12} className="text-accent" />,
          subtitle: "Real-time communication & media stream",
        };
      case "calls":
        return {
          title: "Voice & Video Hub",
          badge: "WebRTC HD",
          badgeIcon: <Zap size={12} className="text-accent" />,
          subtitle: "Zero-drop predictive call recovery active",
        };
      case "contacts":
        return {
          title: "Directory",
          badge: "Community",
          badgeIcon: null,
          subtitle: "People, organizations & public channels",
        };
      case "workspace":
        return {
          title: "Workspace Studio",
          badge: "Collaborative",
          badgeIcon: null,
          subtitle: "Infinite canvas, shared notes & real-time sync",
        };
      case "settings":
        return {
          title: "System Preferences",
          badge: "Profile & Security",
          badgeIcon: null,
          subtitle: "Appearance, encryption PIN & accessibility",
        };
    }
  };

  const { title, badge, badgeIcon, subtitle } = getTabMeta();

  return (
    <header className="app-top-header" role="banner">
      <div className="header-info">
        <div className="header-title-row">
          <h1 className="header-title">{title}</h1>
          {badge && (
            <span className="header-badge-tag">
              {badgeIcon}
              <span>{badge}</span>
            </span>
          )}
        </div>
        <p className="header-subtitle">{subtitle}</p>
      </div>

      <div className="header-actions">
        <div
          className={`network-status-badge ${isOnline ? "is-online" : "is-offline"}`}
          role="status"
          aria-live="polite"
          title={isOnline ? "Network: Stable WebRTC & WebSocket Active" : "Network: Disconnected"}
        >
          {isOnline ? <Wifi size={13} className="text-accent" /> : <WifiOff size={13} className="text-danger" />}
          <span className="network-status-label">{isOnline ? "Online" : "Offline"}</span>
        </div>

        <button
          type="button"
          className="header-ghost-btn"
          onClick={onOpenQrModal}
          title="Share Profile / Scan QR"
          aria-label="Profile QR code"
        >
          <QrCode size={16} />
        </button>

        <button
          type="button"
          className="header-primary-cta"
          onClick={onStartInstantCall}
          title="Start Instant Video Call"
          aria-label="Start call"
        >
          <Video size={15} />
          <span>New Call</span>
        </button>
      </div>
    </header>
  );
}
