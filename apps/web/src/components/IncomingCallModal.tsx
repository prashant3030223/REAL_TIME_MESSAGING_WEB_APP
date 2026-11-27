import { Phone, PhoneOff, Video } from "lucide-react";
import { soundFx } from "../services/soundFx.js";
import { useEffect } from "react";
import { getSafeAvatar } from "../services/avatars.js";

type IncomingCallModalProps = {
  isOpen: boolean;
  callerName: string;
  callerAvatar: string;
  isVideo: boolean;
  onAccept: () => void;
  onDecline: () => void;
};

export function IncomingCallModal({
  isOpen,
  callerName,
  callerAvatar,
  isVideo,
  onAccept,
  onDecline,
}: IncomingCallModalProps) {
  useEffect(() => {
    if (!isOpen) return;
    return soundFx.startCallRinging();
  }, [isOpen]);

  if (!isOpen) return null;

  const safeCallerAvatar = getSafeAvatar(callerAvatar, callerName);
  const fallbackAvatar = getSafeAvatar(undefined, callerName);

  return (
    <div className="modal-backdrop incoming-call-backdrop">
      <div className="modal-card incoming-call-card">
        <div className="incoming-avatar-ring">
          <img
            src={safeCallerAvatar}
            alt={callerName}
            className="incoming-avatar-img"
            onError={(event) => {
              if (event.currentTarget.src !== fallbackAvatar) {
                event.currentTarget.src = fallbackAvatar;
              }
            }}
          />
          <span className="incoming-call-pulse-circle" />
        </div>

        <div className="incoming-call-info">
          <span className="incoming-call-badge">
            {isVideo ? <Video size={14} className="text-accent" /> : <Phone size={14} className="text-success" />}
            <span>Incoming {isVideo ? "Video" : "Voice"} Call</span>
          </span>
          <h2 className="incoming-caller-title">{callerName}</h2>
          <p className="incoming-call-sub">ConnectSphere Calling</p>
        </div>

        <div className="incoming-actions-row">
          <button
            type="button"
            className="incoming-btn decline-btn"
            onClick={onDecline}
            title="Decline Call"
          >
            <PhoneOff size={22} />
            <span>Decline</span>
          </button>

          <button
            type="button"
            className="incoming-btn accept-btn"
            onClick={onAccept}
            title="Accept Call"
          >
            {isVideo ? <Video size={22} /> : <Phone size={22} />}
            <span>Accept</span>
          </button>
        </div>
      </div>
    </div>
  );
}

