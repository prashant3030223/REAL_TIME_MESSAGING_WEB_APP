import React, { useState } from 'react';
import { ChatSidebar } from '../components/chat/ChatSidebar';
import { ChatArea } from '../components/chat/ChatArea';
import { useChat } from '../context/ChatContext';

export const Messages: React.FC = () => {
  const { selectedConversationId } = useChat();
  const [showMobileChat, setShowMobileChat] = useState<boolean>(true);

  return (
    <div className="h-[calc(100vh-6rem)] sm:h-[calc(100vh-7rem)] flex rounded-2xl overflow-hidden border border-brand-border bg-brand-card/70 shadow-2xl backdrop-blur-xl">
      {/* Conversations List (Sidebar) */}
      <div
        className={`w-full md:w-80 lg:w-96 shrink-0 h-full ${
          showMobileChat ? 'hidden md:block' : 'block'
        }`}
      >
        <ChatSidebar />
      </div>

      {/* Chat Area (Active conversation messages and input) */}
      <div
        className={`flex-1 h-full flex flex-col ${
          !showMobileChat ? 'hidden md:flex' : 'flex'
        }`}
      >
        <ChatArea onBackMobile={() => setShowMobileChat(false)} />
      </div>
    </div>
  );
};
