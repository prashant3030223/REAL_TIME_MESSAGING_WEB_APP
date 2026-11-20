import React from 'react';
import { Conversation } from '../../types';
import { Avatar } from '../common/Avatar';
import { formatRelativeTime } from '../../utils/formatters';
import { CheckCheck, Check, Clock } from 'lucide-react';
import { cn } from '../../utils/cn';

interface ConversationItemProps {
  conversation: Conversation;
  isSelected: boolean;
  onSelect: () => void;
}

export const ConversationItem: React.FC<ConversationItemProps> = ({
  conversation,
  isSelected,
  onSelect,
}) => {
  const { contact, lastMessage, unreadCount, isPinned } = conversation;

  return (
    <div
      onClick={onSelect}
      className={cn(
        'w-full p-3 rounded-xl cursor-pointer transition-all duration-150 flex items-center justify-between text-left select-none group',
        isSelected
          ? 'bg-gradient-to-r from-indigo-950/50 to-brand-surface border border-indigo-500/30 shadow-sm'
          : 'hover:bg-brand-surface/50 border border-transparent'
      )}
    >
      <div className="flex items-center gap-3 min-w-0 pr-2">
        <Avatar
          name={contact.name}
          src={contact.avatar}
          status={contact.status}
          showStatus
          size="md"
        />

        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-1">
            <span
              className={cn(
                'text-sm font-semibold truncate transition-colors',
                isSelected ? 'text-white' : 'text-slate-200 group-hover:text-white'
              )}
            >
              {contact.name}
            </span>
          </div>

          <div className="flex items-center gap-1.5 mt-0.5">
            {lastMessage.isMe && (
              <span className="shrink-0">
                {lastMessage.status === 'read' ? (
                  <CheckCheck className="w-3.5 h-3.5 text-indigo-400" />
                ) : (
                  <Check className="w-3.5 h-3.5 text-brand-dim" />
                )}
              </span>
            )}
            <p
              className={cn(
                'text-xs truncate',
                unreadCount > 0 ? 'text-white font-medium' : 'text-brand-muted'
              )}
            >
              {lastMessage.content}
            </p>
          </div>
        </div>
      </div>

      <div className="flex flex-col items-end gap-1.5 shrink-0 pl-1">
        <span className="text-[10px] text-brand-dim font-medium whitespace-nowrap">
          {formatRelativeTime(lastMessage.timestamp)}
        </span>

        <div className="flex items-center gap-1">
          {isPinned && (
            <span className="w-1.5 h-1.5 rounded-full bg-indigo-400" title="Pinned Conversation" />
          )}
          {unreadCount > 0 && (
            <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-indigo-500 text-white text-[10px] font-bold flex items-center justify-center shadow-sm">
              {unreadCount}
            </span>
          )}
        </div>
      </div>
    </div>
  );
};
