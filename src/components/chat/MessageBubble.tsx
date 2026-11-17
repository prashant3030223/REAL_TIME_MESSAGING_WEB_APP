import React from 'react';
import { Message } from '../../types';
import { Avatar } from '../common/Avatar';
import { formatMessageTime } from '../../utils/formatters';
import { CheckCheck, Check } from 'lucide-react';
import { cn } from '../../utils/cn';

interface MessageBubbleProps {
  message: Message;
}

export const MessageBubble: React.FC<MessageBubbleProps> = ({ message }) => {
  const { content, timestamp, status, isMe, senderName, senderAvatar } = message;

  return (
    <div
      className={cn(
        'flex gap-2.5 max-w-[85%] sm:max-w-[75%] my-2 select-text group',
        isMe ? 'ml-auto flex-row-reverse text-right' : 'mr-auto text-left'
      )}
    >
      {/* Avatar for other peer */}
      {!isMe && (
        <Avatar
          name={senderName}
          src={senderAvatar}
          size="sm"
          className="mt-1 shrink-0"
        />
      )}

      <div className="flex flex-col min-w-0">
        {!isMe && (
          <span className="text-[11px] font-medium text-brand-dim mb-1 ml-1">
            {senderName}
          </span>
        )}

        <div
          className={cn(
            'relative px-4 py-2.5 rounded-2xl text-sm leading-relaxed shadow-sm break-words',
            isMe
              ? 'bg-gradient-to-r from-indigo-600 to-indigo-500 text-white rounded-tr-none border border-indigo-400/20'
              : 'bg-brand-surface border border-brand-borderLight/20 text-brand-text rounded-tl-none'
          )}
        >
          <p className="whitespace-pre-wrap">{content}</p>

          <div
            className={cn(
              'mt-1 flex items-center gap-1 text-[10px] select-none',
              isMe ? 'justify-end text-indigo-200/80' : 'justify-start text-brand-dim'
            )}
          >
            <span>{formatMessageTime(timestamp)}</span>
            {isMe && (
              <span title={status === 'read' ? 'Read' : 'Delivered'}>
                {status === 'read' ? (
                  <CheckCheck className="w-3.5 h-3.5 text-indigo-200" />
                ) : (
                  <Check className="w-3.5 h-3.5 text-indigo-300/70" />
                )}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
