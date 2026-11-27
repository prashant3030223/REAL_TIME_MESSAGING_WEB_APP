import { useEffect, useState } from "react";
import {
  User as UserIcon,
  Shield,
  ShieldCheck,
  ShieldAlert,
  Users,
  Globe,
  Volume2,
  Lock,
  Check,
  LogOut,
  Key,
  Server,
  Activity,
  Bell,
  Eye,
  CheckCircle2,
  AlertCircle,
  Mail,
  AtSign,
  FileText,
  Save,
} from "lucide-react";
import type { User, ProfilePhotoProtection } from "../services/types.js";
import type { AccessibilitySettings } from "../services/storage.js";
import { MEMOJI_AVATARS, getSafeAvatar } from "../services/avatars.js";
import { BrowserPushSettings } from "../components/BrowserPushSettings.js";

type SettingsViewProps = {
  initialSection?: "profile" | "security" | "accessibility";
  currentUser: User;
  onUpdateUser: (user: User) => Promise<void>;
  onLockApp: () => void;
  appPin: string | null;
  hasLockedConversations: boolean;
  onUpdatePin: (pin: string | null) => void;
  accessibility: AccessibilitySettings;
  onUpdateAccessibility: (settings: AccessibilitySettings) => void;
  onUpdateReadReceipts: (enabled: boolean) => Promise<void>;
  onSignOut: () => Promise<void>;
};

export function SettingsView({
  initialSection = "profile",
  currentUser,
  onUpdateUser,
  onLockApp,
  appPin,
  hasLockedConversations,
  onUpdatePin,
  accessibility,
  onUpdateAccessibility,
  onUpdateReadReceipts,
  onSignOut,
}: SettingsViewProps) {
  const [activeSection, setActiveSection] = useState<
    "profile" | "security" | "accessibility"
  >(initialSection);

  // Profile Form state
  const [displayName, setDisplayName] = useState(currentUser.displayName);
  const [username, setUsername] = useState(currentUser.username);
  const [bio, setBio] = useState(currentUser.bio ?? "");
  const [statusText, setStatusText] = useState(currentUser.statusText ?? "");
  const [avatar, setAvatar] = useState(getSafeAvatar(currentUser.avatar, currentUser.displayName));
  const [profilePhotoProtection, setProfilePhotoProtection] = useState<ProfilePhotoProtection>(
    currentUser.profilePhotoProtection ?? "nobody"
  );
  const [savedNotification, setSavedNotification] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const [pinError, setPinError] = useState<string | null>(null);

  // Privacy toggles state (local simulation for UI completeness)
  const [showOnlineStatus, setShowOnlineStatus] = useState(true);
  const [sendReadReceipts, setSendReadReceipts] = useState(currentUser.readReceiptsEnabled ?? true);
  const [savingReadReceipts, setSavingReadReceipts] = useState(false);
  const [readReceiptsError, setReadReceiptsError] = useState<string | null>(null);

  useEffect(() => {
    setSendReadReceipts(currentUser.readReceiptsEnabled ?? true);
  }, [currentUser.id, currentUser.readReceiptsEnabled]);

  async function handleSignOut() {
    setSigningOut(true);
    setSignOutError(null);
    try {
      await onSignOut();
    } catch (error) {
      setSignOutError(error instanceof Error ? error.message : "Could not sign out. Please try again.");
    } finally {
      setSigningOut(false);
    }
  }

  async function handleReadReceiptsChange(enabled: boolean) {
    const previousValue = sendReadReceipts;
    setSendReadReceipts(enabled);
    setSavingReadReceipts(true);
    setReadReceiptsError(null);
    try {
      await onUpdateReadReceipts(enabled);
    } catch (error) {
      setSendReadReceipts(currentUser.readReceiptsEnabled ?? previousValue);
      setReadReceiptsError(
        error instanceof Error ? error.message : "Could not update read receipt settings.",
      );
    } finally {
      setSavingReadReceipts(false);
    }
  }

  // Security state
  const [newPin, setNewPin] = useState(appPin ?? "");

  async function handleSaveProfile() {
    setSavingProfile(true);
    setProfileError(null);
    setSavedNotification(false);
    try {
      await onUpdateUser({
        ...currentUser,
        displayName,
        username,
        bio,
        statusText,
        avatar,
        profilePhotoProtection,
      });
      setSavedNotification(true);
      setTimeout(() => setSavedNotification(false), 2000);
    } catch (error) {
      setProfileError(error instanceof Error ? error.message : "Could not save your profile.");
    } finally {
      setSavingProfile(false);
    }
  }

  function handleSavePin() {
    if (newPin && !/^\d{4}$/.test(newPin)) {
      setPinError("Enter a 4-digit numeric PIN.");
      return;
    }
    if (!newPin && appPin && hasLockedConversations) {
      setPinError("Unlock all PIN-protected conversations before removing your PIN.");
      return;
    }
    setPinError(null);
    onUpdatePin(newPin || null);
    setSavedNotification(true);
    setTimeout(() => setSavedNotification(false), 2000);
  }

  return (
    <div className="settings-page-layout">
      {/* Left Navigation Sidebar */}
      <aside className="settings-nav-sidebar">
        <div className="settings-nav-header">
          <h2>Preferences</h2>
          <p className="subtitle-text">Configure identity, privacy &amp; security</p>
        </div>

        <nav className="settings-nav-list" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={activeSection === "profile"}
            className={`settings-nav-item ${activeSection === "profile" ? "is-active" : ""}`}
            onClick={() => setActiveSection("profile")}
          >
            <UserIcon size={17} />
            <span>Profile &amp; Account</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeSection === "security"}
            className={`settings-nav-item ${activeSection === "security" ? "is-active" : ""}`}
            onClick={() => setActiveSection("security")}
          >
            <Shield size={17} />
            <span>Security &amp; App Lock</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeSection === "accessibility"}
            className={`settings-nav-item ${activeSection === "accessibility" ? "is-active" : ""}`}
            onClick={() => setActiveSection("accessibility")}
          >
            <Volume2 size={17} />
            <span>Accessibility</span>
          </button>
        </nav>

        <div className="settings-nav-footer">
          {signOutError && <p className="signout-error-text">{signOutError}</p>}
          <button
            type="button"
            className="signout-btn"
            onClick={handleSignOut}
            disabled={signingOut}
          >
            <LogOut size={16} />
            <span>{signingOut ? "Signing out..." : "Sign Out"}</span>
          </button>
        </div>
      </aside>

      {/* Main Settings Content Area */}
      <main className="settings-content-pane">
        {savedNotification && (
          <div className="settings-toast-banner" role="status">
            <Check size={16} className="text-success" />
            <span>Preferences updated successfully!</span>
          </div>
        )}

        {/* 1. Profile & Account */}
        {activeSection === "profile" && (
          <div className="settings-multi-card-grid">
            {/* Live Profile Overview Card */}
            <div className="settings-card profile-preview-card">
              <div className="section-title-wrap">
                <h3>Live Identity Card</h3>
                <p>How you appear across conversations, directory, and calls.</p>
              </div>

              <div className="profile-identity-display">
                <div className="identity-avatar-ring">
                  <img src={getSafeAvatar(avatar, displayName)} alt={displayName} className="identity-avatar-img" />
                  <span className="identity-online-dot" />
                </div>
                <div className="identity-text">
                  <h4 className="identity-name">{displayName || "Your Name"}</h4>
                  <span className="identity-username">@{username || "username"}</span>
                  <span className="identity-status-pill">{statusText || "Available"}</span>
                </div>
              </div>

              {currentUser.email && (
                <div className="account-email-box">
                  <Mail size={15} className="text-accent" />
                  <span className="account-email-text">{currentUser.email}</span>
                </div>
              )}

              {/* 3D Memoji Avatar Picker Palette */}
              <div className="avatar-picker-section">
                <span className="picker-title">Choose 3D Memoji Avatar</span>
                <div className="settings-memoji-grid">
                  {/* Plus button for custom photo upload */}
                  <label className="settings-avatar-upload-tile" title="Upload custom photo">
                    <input
                      type="file"
                      accept="image/*"
                      style={{ display: "none" }}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          const reader = new FileReader();
                          reader.onload = (ev) => {
                            const res = ev.target?.result as string;
                            if (res) setAvatar(res);
                          };
                          reader.readAsDataURL(file);
                        }
                      }}
                    />
                    <span className="upload-tile-plus">+</span>
                  </label>

                  {/* 28 3D Memoji Avatars matching Reference */}
                  {MEMOJI_AVATARS.map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      className={`mini-memoji-choice ${avatar === opt.url ? "is-selected" : ""}`}
                      onClick={() => setAvatar(opt.url)}
                      title={opt.label}
                    >
                      <img src={opt.url} alt={opt.label} />
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Profile Edit Form Card */}
            <div className="settings-card credentials-edit-card">
              <div className="section-title-wrap">
                <div className="section-title-flex">
                  <div className="section-icon-badge">
                    <UserIcon size={18} className="text-accent" />
                  </div>
                  <div>
                    <h2>Account Credentials</h2>
                    <p>Update your public identity, display name, handle, and personal status.</p>
                  </div>
                </div>
              </div>

              {profileError && (
                <div className="settings-error-banner" role="alert">
                  <AlertCircle size={15} />
                  <span>{profileError}</span>
                </div>
              )}

              <div className="credentials-form-grid">
                {/* Display Name */}
                <div className="credentials-field">
                  <label className="credentials-label" htmlFor="settings-display-name">
                    <UserIcon size={13} className="field-header-icon" />
                    <span>Display / Full Name</span>
                  </label>
                  <div className="credentials-input-box">
                    <input
                      id="settings-display-name"
                      type="text"
                      className="credentials-text-input"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      placeholder="e.g. Prashant Yadav"
                    />
                  </div>
                  <span className="credentials-hint">Visible to contacts in chat and calls</span>
                </div>

                {/* Username */}
                <div className="credentials-field">
                  <label className="credentials-label" htmlFor="settings-username">
                    <AtSign size={13} className="field-header-icon" />
                    <span>Username</span>
                  </label>
                  <div className="credentials-input-box">
                    <span className="input-prefix">@</span>
                    <input
                      id="settings-username"
                      type="text"
                      className="credentials-text-input has-prefix"
                      value={username}
                      onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))}
                      placeholder="username"
                    />
                  </div>
                  <span className="credentials-hint">Unique handle for direct messaging</span>
                </div>

                {/* Custom Status Note */}
                <div className="credentials-field full-width">
                  <label className="credentials-label" htmlFor="settings-status-note">
                    <Activity size={13} className="field-header-icon" />
                    <span>Custom Status Note</span>
                  </label>
                  <div className="credentials-input-box">
                    <input
                      id="settings-status-note"
                      type="text"
                      className="credentials-text-input"
                      value={statusText}
                      onChange={(e) => setStatusText(e.target.value)}
                      placeholder="e.g. Available for calls / In a focused session"
                    />
                  </div>
                  <span className="credentials-hint">Broadcast live under your name across ConnectSphere</span>
                </div>

                {/* About / Bio */}
                <div className="credentials-field full-width">
                  <label className="credentials-label" htmlFor="settings-bio">
                    <FileText size={13} className="field-header-icon" />
                    <span>About / Bio</span>
                  </label>
                  <div className="credentials-input-box is-textarea">
                    <textarea
                      id="settings-bio"
                      className="credentials-text-input credentials-textarea"
                      rows={3}
                      value={bio}
                      onChange={(e) => setBio(e.target.value)}
                      placeholder="Write a brief note about your responsibilities or interests..."
                    />
                  </div>
                </div>
              </div>

              <div className="credentials-footer-bar">
                <button
                  type="button"
                  className="primary-action-btn credentials-save-btn"
                  onClick={() => void handleSaveProfile()}
                  disabled={savingProfile}
                >
                  <Save size={15} />
                  <span>{savingProfile ? "Saving Changes..." : "Save Profile Changes"}</span>
                </button>
              </div>
            </div>

            {/* Profile Photo Screenshot Block (Custom Control) */}
            <div className="settings-card screenshot-protection-card">
              <div className="section-title-wrap">
                <div className="section-title-flex">
                  <div className="section-icon-badge" style={{ background: "rgba(0, 168, 132, 0.15)", color: "#00a884" }}>
                    <ShieldAlert size={18} />
                  </div>
                  <div>
                    <h2>Profile Photo Privacy</h2>
                    <p>Choose who can view an unblurred profile photo. Websites cannot prevent screenshots taken with a device or operating system.</p>
                  </div>
                </div>
              </div>

              <div className="protection-options-grid">
                <button
                  type="button"
                  className={`protection-card-option ${profilePhotoProtection === "nobody" ? "is-selected" : ""}`}
                  onClick={() => setProfilePhotoProtection("nobody")}
                >
                  <div className="protection-radio-dot" />
                  <div className="protection-info">
                    <div className="protection-head">
                      <Lock size={15} className="text-accent" />
                      <span className="protection-title">Restrict for Everyone</span>
                    </div>
                    <p className="protection-desc">
                      Other people see a blurred profile photo preview. This setting cannot block device screenshots.
                    </p>
                  </div>
                </button>

                <button
                  type="button"
                  className={`protection-card-option ${profilePhotoProtection === "contacts" ? "is-selected" : ""}`}
                  onClick={() => setProfilePhotoProtection("contacts")}
                >
                  <div className="protection-radio-dot" />
                  <div className="protection-info">
                    <div className="protection-head">
                      <Users size={15} className="text-accent" />
                      <span className="protection-title">My Contacts Only</span>
                    </div>
                    <p className="protection-desc">
                      Only accepted connections see an unblurred photo; other people see a blurred preview.
                    </p>
                  </div>
                </button>

                <button
                  type="button"
                  className={`protection-card-option ${profilePhotoProtection === "everyone" ? "is-selected" : ""}`}
                  onClick={() => setProfilePhotoProtection("everyone")}
                >
                  <div className="protection-radio-dot" />
                  <div className="protection-info">
                    <div className="protection-head">
                      <Globe size={15} className="text-accent" />
                      <span className="protection-title">Allow Everyone</span>
                    </div>
                    <p className="protection-desc">
                      Anyone can view an unblurred profile photo. Device screenshots remain under the viewer's control.
                    </p>
                  </div>
                </button>
              </div>

              <div className="protection-card-footer" style={{ marginTop: 16 }}>
                <button
                  type="button"
                  className="primary-action-btn credentials-save-btn"
                  onClick={() => void handleSaveProfile()}
                  disabled={savingProfile}
                >
                  <Save size={15} />
                  <span>{savingProfile ? "Saving Preferences..." : "Save Photo Privacy"}</span>
                </button>
              </div>
            </div>

            {/* Session Management / Sign Out Card */}
            <div className="settings-card settings-signout-card">
              <div className="section-title-wrap">
                <h2>Session &amp; Account Access</h2>
                <p>Sign out of this device. Your data remains safely encrypted on the cloud.</p>
              </div>
              {signOutError && <p className="signout-error-text">{signOutError}</p>}
              <div className="settings-signout-actions">
                <button
                  type="button"
                  className="signout-action-btn"
                  onClick={handleSignOut}
                  disabled={signingOut}
                >
                  <LogOut size={16} />
                  <span>{signingOut ? "Signing out..." : "Sign Out of ConnectSphere"}</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 2. Security & PIN Lock */}
        {activeSection === "security" && (
          <div className="settings-multi-card-grid">
            {/* Card 1: 4-Digit App PIN Lock */}
            <div className="settings-card">
              <div className="section-title-wrap">
                <div className="section-title-flex">
                  <Lock size={20} className="text-accent" />
                  <div>
                    <h2>4-Digit App PIN Lock</h2>
                    <p>Protect your session and confidential conversations with a quick lock code.</p>
                  </div>
                </div>
              </div>

              <div className="security-pin-box">
                <div className="pin-status-header">
                  <span className="status-label">Lock Status:</span>
                  <span className={`security-badge ${appPin ? "is-enabled" : "is-disabled"}`}>
                    <ShieldCheck size={14} />
                    <span>{appPin ? "PIN Protection Active" : "No PIN Set"}</span>
                  </span>
                </div>

                <div className="pin-input-action-row">
                  <input
                    type="password"
                    inputMode="numeric"
                    maxLength={4}
                    placeholder="4-digit PIN"
                    value={newPin}
                    onChange={(e) => {
                      setNewPin(e.target.value.replace(/\D/g, "").slice(0, 4));
                      setPinError(null);
                    }}
                    className="enhanced-text-field pin-field"
                  />
                  <button
                    type="button"
                    className="primary-action-btn"
                    onClick={handleSavePin}
                    disabled={!newPin && !appPin}
                  >
                    {newPin ? "Save PIN" : appPin ? "Remove PIN" : "Set PIN"}
                  </button>
                </div>

                {pinError && <p className="pin-error-text" role="alert">{pinError}</p>}
              </div>

              <div className="pin-lock-actions">
                <button
                  type="button"
                  className="secondary-btn lock-now-btn"
                  onClick={onLockApp}
                  disabled={!appPin}
                >
                  <Lock size={15} />
                  <span>Lock App Now</span>
                </button>
                <span className="lock-hint">
                  {appPin
                    ? "Locking hides all chats behind your 4-digit PIN immediately."
                    : "Set a 4-digit PIN to enable instant app locking."}
                </span>
              </div>
            </div>

            {/* Card 2: Active Session & Auth Security */}
            <div className="settings-card security-specs-card">
              <div className="section-title-wrap">
                <div className="section-title-flex">
                  <Server size={20} className="text-accent" />
                  <div>
                    <h2>Active Session Security</h2>
                    <p>Cryptographic tokens and browser session safeguards.</p>
                  </div>
                </div>
              </div>

              <div className="security-specs-list">
                <div className="spec-row">
                  <span className="spec-label">Authenticated Account</span>
                  <span className="spec-value text-accent">{currentUser.email || `@${currentUser.username}`}</span>
                </div>
                <div className="spec-row">
                  <span className="spec-label">Cookie Protection</span>
                  <span className="spec-value">HttpOnly • SameSite=Strict</span>
                </div>
                <div className="spec-row">
                  <span className="spec-label">Session Lifetime</span>
                  <span className="spec-value">7 Days Rolling Token</span>
                </div>
                <div className="spec-row">
                  <span className="spec-label">Password Hashing</span>
                  <span className="spec-value">Scrypt (N=32768, r=8, p=1)</span>
                </div>
              </div>

              <div className="session-status-badge">
                <CheckCircle2 size={16} className="text-success" />
                <span>Session is securely authenticated with PostgreSQL token store.</span>
              </div>
            </div>

            {/* Card 3: Real-Time Encryption & Media Security */}
            <div className="settings-card security-specs-card">
              <div className="section-title-wrap">
                <div className="section-title-flex">
                  <ShieldCheck size={20} className="text-accent" />
                  <div>
                    <h2>Real-Time Media Encryption</h2>
                    <p>Protocols securing WebRTC voice, video, and collaboration data.</p>
                  </div>
                </div>
              </div>

              <div className="security-specs-list">
                <div className="spec-row">
                  <span className="spec-label">Voice &amp; Video Streams</span>
                  <span className="spec-value text-success">WebRTC DTLS 1.3 / SRTP</span>
                </div>
                <div className="spec-row">
                  <span className="spec-label">Data Channel Cryptography</span>
                  <span className="spec-value text-success">AES-256-GCM Direct Peer</span>
                </div>
                <div className="spec-row">
                  <span className="spec-label">Signaling Gateway</span>
                  <span className="spec-value">WSS Secure WebSocket</span>
                </div>
              </div>

              <div className="encryption-notice-tag">
                <ShieldCheck size={15} className="text-accent" />
                <span>Media streams flow directly peer-to-peer and are never recorded on application servers.</span>
              </div>
            </div>

            {/* Card 4: Privacy Preferences */}
            <div className="settings-card">
              <div className="section-title-wrap">
                <div className="section-title-flex">
                  <Eye size={20} className="text-accent" />
                  <div>
                    <h2>Privacy Controls</h2>
                    <p>Choose what others see when communicating with you.</p>
                  </div>
                </div>
              </div>

              <div className="privacy-toggles-list">
                <label className="toggle-setting-row">
                  <div>
                    <strong>Share Online Presence</strong>
                    <p>Display your active status and last seen timestamp</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={showOnlineStatus}
                    onChange={(e) => setShowOnlineStatus(e.target.checked)}
                    className="toggle-checkbox"
                  />
                </label>

                <label className="toggle-setting-row">
                  <div>
                    <strong>Send Read Receipts</strong>
                    <p>Let others see when you read their messages. Turn off to hide your read status.</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={sendReadReceipts}
                    onChange={(e) => void handleReadReceiptsChange(e.target.checked)}
                    disabled={savingReadReceipts}
                    aria-describedby={readReceiptsError ? "read-receipts-error" : undefined}
                    className="toggle-checkbox"
                  />
                </label>
                {readReceiptsError && (
                  <p id="read-receipts-error" className="settings-error-banner" role="alert">
                    {readReceiptsError}
                  </p>
                )}

                <label className="toggle-setting-row">
                  <div>
                    <strong>Chime &amp; Audio Feedback</strong>
                    <p>Play ringing on both sides, chat notifications, and call-end sounds</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={accessibility.soundFeedback}
                    onChange={(e) =>
                      onUpdateAccessibility({ ...accessibility, soundFeedback: e.target.checked })
                    }
                    className="toggle-checkbox"
                  />
                </label>
              </div>
            </div>
          </div>
        )}

        {/* 4. Accessibility */}
        {activeSection === "accessibility" && (
          <div className="settings-card">
            <div className="section-title-wrap">
              <h2>Accessibility Preferences</h2>
              <p>Adjust motion and contrast for comfortable viewing across devices.</p>
            </div>

            <div className="toggle-setting-row">
              <div>
                <strong>Reduced Motion</strong>
                <p>Minimize animations, transitions, and pulsing rings across the interface</p>
              </div>
              <input
                type="checkbox"
                checked={accessibility.reducedMotion}
                onChange={(e) =>
                  onUpdateAccessibility({ ...accessibility, reducedMotion: e.target.checked })
                }
                className="toggle-checkbox"
              />
            </div>

            <div className="toggle-setting-row">
              <div>
                <strong>High Contrast Mode</strong>
                <p>Enhance border definition and text contrast for maximum legibility</p>
              </div>
              <input
                type="checkbox"
                checked={accessibility.highContrast}
                onChange={(e) =>
                  onUpdateAccessibility({ ...accessibility, highContrast: e.target.checked })
                }
                className="toggle-checkbox"
              />
            </div>

            <BrowserPushSettings />
          </div>
        )}
      </main>
    </div>
  );
}
