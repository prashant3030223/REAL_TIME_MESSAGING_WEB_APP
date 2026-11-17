import React, { useState } from 'react';
import { Contact } from '../../types';
import { Avatar } from '../common/Avatar';
import { Badge } from '../common/Badge';
import { ComingSoonModal } from '../layout/ComingSoonModal';
import {
  Phone,
  Video,
  Info,
  ChevronLeft,
  Shield,
  Circle,
} from 'lucide-react';

interface ChatHeaderProps {
  contact: Contact;
  onBackMobile?: () => void;
}

export const ChatHeader: React.FC<ChatHeaderProps> = ({ contact, onBackMobile }) => {
  const [modalConfig, setModalConfig] = useState<{
    feature: string;
    phase: string;
    description: string;
    tech: string[];
  } | null>(null);

  const getStatusLabel = (status: Contact['status']) => {
    switch (status) {
      case 'online':
        return 'Online • Active in cluster';
      case 'busy':
        return 'Busy • In review session';
      case 'away':
        return 'Away • Last seen 15m ago';
      case 'offline':
        return 'Offline';
    }
  };

  return (
    <>
      <div className="h-16 px-4 md:px-6 border-b border-brand-border bg-brand-card/90 flex items-center justify-between">
        {/* Left: Contact Info */}
        <div className="flex items-center gap-3 min-w-0">
          {onBackMobile && (
            <button
              onClick={onBackMobile}
              className="md:hidden p-1.5 -ml-1 rounded-lg text-brand-dim hover:text-white hover:bg-brand-surface transition-colors"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
          )}

          <Avatar
            name={contact.name}
            src={contact.avatar}
            status={contact.status}
            showStatus
            size="md"
          />

          <div className="min-w-0 text-left">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-white truncate">{contact.name}</h3>
              <span className="hidden sm:inline-block text-[10px] px-1.5 py-0.2 rounded bg-brand-surface border border-brand-border text-brand-dim">
                {contact.role}
              </span>
            </div>
            <p className="text-[11px] text-brand-muted flex items-center gap-1.5">
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  contact.status === 'online'
                    ? 'bg-emerald-400'
                    : contact.status === 'busy'
                    ? 'bg-rose-400'
                    : contact.status === 'away'
                    ? 'bg-amber-400'
                    : 'bg-slate-400'
                }`}
              />
              <span>{getStatusLabel(contact.status)}</span>
            </p>
          </div>
        </div>

        {/* Right: Actions (Voice, Video, Info) */}
        <div className="flex items-center gap-1 sm:gap-2">
          <button
            onClick={() =>
              setModalConfig({
                feature: 'Voice Call Module',
                phase: 'Phase 2',
                description:
                  'Peer-to-peer WebRTC encrypted voice communication with Opus audio codec, noise suppression, and STUN/TURN traversal.',
                tech: ['WebRTC AudioTrack', 'Opus Codec', 'ICE Candidates', 'STUN/TURN'],
              })
            }
            className="p-2 rounded-lg text-brand-dim hover:text-white hover:bg-brand-surface transition-colors relative group"
            title="Start Audio Call (Phase 2)"
          >
            <Phone className="w-4 h-4" />
          </button>

          <button
            onClick={() =>
              setModalConfig({
                feature: 'Video Conference Module',
                phase: 'Phase 2',
                description:
                  'Real-time multi-peer video streaming powered by WebRTC mesh topology with adaptive bitrate and screen sharing capabilities.',
                tech: ['WebRTC VideoStreams', 'VP9/H.264', 'SFU / Mesh Router', 'Screen Capture API'],
              })
            }
            className="p-2 rounded-lg text-brand-dim hover:text-white hover:bg-brand-surface transition-colors"
            title="Start Video Call (Phase 2)"
          >
            <Video className="w-4 h-4" />
          </button>

          <div className="h-4 w-[1px] bg-brand-border mx-1 hidden sm:block" />

          <button
            onClick={() =>
              setModalConfig({
                feature: 'Distributed Node Security Details',
                phase: 'Phase 1 Context',
                description: `${contact.name} is a verified node in the ${contact.department}. Communication is currently running via Phase 1 local UI simulation.`,
                tech: ['Local React State', 'TypeScript Schema', 'Zero-Trust Architecture'],
              })
            }
            className="p-2 rounded-lg text-brand-dim hover:text-white hover:bg-brand-surface transition-colors"
            title="Channel Info"
          >
            <Info className="w-4 h-4" />
          </button>
        </div>
      </div>

      {modalConfig && (
        <ComingSoonModal
          isOpen={!!modalConfig}
          onClose={() => setModalConfig(null)}
          featureName={modalConfig.feature}
          plannedPhase={modalConfig.phase}
          description={modalConfig.description}
          plannedTech={modalConfig.tech}
        />
      )}
    </>
  );
};
