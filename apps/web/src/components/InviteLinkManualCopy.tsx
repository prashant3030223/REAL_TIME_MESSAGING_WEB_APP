import { X } from "lucide-react";

type InviteLinkManualCopyProps = {
  url: string;
  onClose: () => void;
};

export function InviteLinkManualCopy({ url, onClose }: InviteLinkManualCopyProps) {
  return (
    <aside className="invite-link-manual-card" aria-label="Manual invite link copy" aria-live="polite">
      <div className="invite-link-manual-header">
        <strong>Copy invite link manually</strong>
        <button type="button" onClick={onClose} aria-label="Close invite link">
          <X size={16} />
        </button>
      </div>
      <p>Automatic sharing and copying aren’t available. Tap the link below to select it, then copy.</p>
      <input
        type="text"
        readOnly
        value={url}
        aria-label="ConnectSphere invite link"
        onFocus={(event) => event.currentTarget.select()}
        onClick={(event) => event.currentTarget.select()}
      />
    </aside>
  );
}
