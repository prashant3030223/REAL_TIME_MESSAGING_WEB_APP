import React, { useRef, useEffect } from 'react';
import { useChat } from '../../context/ChatContext';
import { ChatHeader } from './ChatHeader';
import { MessageBubble } from './MessageBubble';
import { MessageInput } from './MessageInput';
import { MessageSquare, Shield, Sparkles } from 'lucide-react';

interface ChatAreaProps {
  onBackMobile?: () => void;
}

export const ChatArea: React.FC<ChatAreaProps> = ({ onBackMobile }) => {
  const { activeConversation, activeMessages, sendMessage } = useChat();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom of chat when new message arrives
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeMessages]);

  if (!activeConversation) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-brand-bg select-none">
        <div className="w-16 h-16 rounded-2xl bg-brand-surface border border-brand-border flex items-center justify-center mb-4 text-indigo-400">
          <MessageSquare className="w-8 h-8" />
        </div>
        <h3 className="text-lg font-bold text-white">No Conversation Selected</h3>
        <p className="mt-1 text-xs text-brand-muted max-w-sm">
          Select a peer or mentor from the left conversation list to begin real-time messaging demonstration.
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full bg-brand-bg/50 overflow-hidden">
      {/* Contact Header */}
      <ChatHeader
        contact={activeConversation.contact}
        onBackMobile={onBackMobile}
      />

      {/* Messages Scroll View */}
      <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-2">
        {/* Thread Start Security Notice */}
        <div className="my-4 text-center">
          <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-brand-surface/70 border border-brand-border text-[11px] text-brand-dim">
            <Shield className="w-3.5 h-3.5 text-indigo-400" />
            <span>ConnectSphere Distributed Channel &bull; Phase 1 Prototype State</span>
          </div>
        </div>

        {/* Message bubbles */}
        {activeMessages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}

        <div ref={messagesEndRef} />
      </div>

      {/* Message Input Box */}
      <MessageInput
        onSendMessage={sendMessage}
        contactName={activeConversation.contact.name}
      />
    </div>
  );
};
