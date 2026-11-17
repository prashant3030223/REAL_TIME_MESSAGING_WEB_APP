import React, { useState } from 'react';
import { ConversationItem } from './ConversationItem';
import { useChat } from '../../context/ChatContext';
import { Search, SlidersHorizontal, MessageSquarePlus, X } from 'lucide-react';
import { Badge } from '../common/Badge';

interface ChatSidebarProps {
  className?: string;
}

export const ChatSidebar: React.FC<ChatSidebarProps> = ({ className }) => {
  const {
    filteredConversations,
    selectedConversationId,
    selectConversation,
    searchQuery,
    setSearchQuery,
    conversations,
  } = useChat();

  const [activeTab, setActiveTab] = useState<'all' | 'unread'>('all');

  const displayedConversations = filteredConversations.filter((conv) => {
    if (activeTab === 'unread') {
      return conv.unreadCount > 0;
    }
    return true;
  });

  return (
    <div className={`flex flex-col h-full bg-brand-card/90 border-r border-brand-border select-none ${className || ''}`}>
      {/* Sidebar Header */}
      <div className="p-4 border-b border-brand-border space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-bold text-white tracking-tight">Messages</h2>
            <Badge variant="primary" size="sm">
              {conversations.length}
            </Badge>
          </div>
          <button
            title="New Conversation (Phase 1 local)"
            onClick={() => selectConversation(conversations[0]?.id || '')}
            className="p-1.5 rounded-lg text-brand-dim hover:text-white hover:bg-brand-surface transition-colors"
          >
            <MessageSquarePlus className="w-4 h-4" />
          </button>
        </div>

        {/* Search input */}
        <div className="relative flex items-center">
          <Search className="w-4 h-4 text-brand-dim absolute left-3 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter conversations..."
            className="w-full pl-9 pr-8 py-2 rounded-lg bg-brand-surface/70 border border-brand-border text-xs text-brand-text placeholder-brand-dim focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50 outline-none transition-all"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 p-0.5 text-brand-dim hover:text-white transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Category Tabs */}
        <div className="flex items-center gap-2 pt-1 text-xs">
          <button
            onClick={() => setActiveTab('all')}
            className={`px-3 py-1 rounded-lg font-medium transition-colors ${
              activeTab === 'all'
                ? 'bg-indigo-600/20 text-indigo-300 border border-indigo-500/30'
                : 'text-brand-muted hover:text-white hover:bg-brand-surface'
            }`}
          >
            All Threads ({conversations.length})
          </button>
          <button
            onClick={() => setActiveTab('unread')}
            className={`px-3 py-1 rounded-lg font-medium transition-colors ${
              activeTab === 'unread'
                ? 'bg-indigo-600/20 text-indigo-300 border border-indigo-500/30'
                : 'text-brand-muted hover:text-white hover:bg-brand-surface'
            }`}
          >
            Unread
          </button>
        </div>
      </div>

      {/* Conversations List */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {displayedConversations.length > 0 ? (
          displayedConversations.map((conv) => (
            <ConversationItem
              key={conv.id}
              conversation={conv}
              isSelected={conv.id === selectedConversationId}
              onSelect={() => selectConversation(conv.id)}
            />
          ))
        ) : (
          <div className="p-8 text-center space-y-2 text-brand-dim">
            <p className="text-xs">No conversations match your search.</p>
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="text-xs text-indigo-400 hover:underline"
              >
                Clear filter
              </button>
            )}
          </div>
        )}
      </div>

      {/* Local Prototype Footer Note */}
      <div className="p-2.5 border-t border-brand-border bg-brand-surface/40 text-[10px] text-brand-dim text-center">
        <span>Phase 1 Mock Threads &bull; Local State Only</span>
      </div>
    </div>
  );
};
