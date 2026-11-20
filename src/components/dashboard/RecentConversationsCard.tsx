import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Card } from '../common/Card';
import { Avatar } from '../common/Avatar';
import { useChat } from '../../context/ChatContext';
import { formatRelativeTime } from '../../utils/formatters';
import { MessageSquare, ArrowRight, CheckCheck, Clock } from 'lucide-react';

export const RecentConversationsCard: React.FC = () => {
  const { conversations, selectConversation } = useChat();
  const navigate = useNavigate();

  const handleOpenConversation = (id: string) => {
    selectConversation(id);
    navigate('/messages');
  };

  return (
    <Card className="text-left flex flex-col h-full">
      <div className="flex items-center justify-between pb-4 border-b border-brand-border">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-lg bg-indigo-500/10 border border-indigo-500/20 text-indigo-400">
            <MessageSquare className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-white">Recent Conversations</h3>
            <p className="text-xs text-brand-dim">Active collaboration threads</p>
          </div>
        </div>
        <button
          onClick={() => navigate('/messages')}
          className="text-xs text-indigo-400 hover:text-indigo-300 font-medium inline-flex items-center gap-1 group"
        >
          <span>View All</span>
          <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
        </button>
      </div>

      <div className="divide-y divide-brand-border/60 flex-1 overflow-y-auto">
        {conversations.slice(0, 4).map((conv) => (
          <div
            key={conv.id}
            onClick={() => handleOpenConversation(conv.id)}
            className="py-3 px-1.5 flex items-center justify-between hover:bg-brand-surface/50 rounded-lg cursor-pointer transition-colors group"
          >
            <div className="flex items-center gap-3 min-w-0 pr-2">
              <Avatar
                name={conv.contact.name}
                src={conv.contact.avatar}
                status={conv.contact.status}
                showStatus
                size="md"
              />
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-white group-hover:text-indigo-300 transition-colors truncate">
                    {conv.contact.name}
                  </span>
                  {conv.isPinned && (
                    <span className="text-[10px] px-1.5 py-0.2 rounded bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                      Pinned
                    </span>
                  )}
                </div>
                <p className="text-xs text-brand-muted truncate mt-0.5">
                  {conv.lastMessage.isMe && (
                    <span className="text-brand-dim mr-1">You:</span>
                  )}
                  {conv.lastMessage.content}
                </p>
              </div>
            </div>

            <div className="flex flex-col items-end gap-1 shrink-0 text-right">
              <span className="text-[11px] text-brand-dim flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {formatRelativeTime(conv.lastMessage.timestamp)}
              </span>
              {conv.unreadCount > 0 ? (
                <span className="w-5 h-5 rounded-full bg-indigo-500 text-white text-[10px] font-bold flex items-center justify-center shadow-sm">
                  {conv.unreadCount}
                </span>
              ) : conv.lastMessage.isMe ? (
                <CheckCheck className="w-4 h-4 text-indigo-400" />
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
};
