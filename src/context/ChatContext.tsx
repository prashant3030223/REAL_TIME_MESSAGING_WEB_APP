import React, { createContext, useContext, useState, useMemo } from 'react';
import { Conversation, Message } from '../types';
import { mockConversations, mockMessagesByConversation } from '../data/mockData';
import { useAuth } from './AuthContext';

interface ChatContextType {
  conversations: Conversation[];
  selectedConversationId: string;
  activeConversation: Conversation | undefined;
  activeMessages: Message[];
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  filteredConversations: Conversation[];
  selectConversation: (id: string) => void;
  sendMessage: (content: string) => void;
  totalUnreadCount: number;
}

const ChatContext = createContext<ChatContextType | undefined>(undefined);

export const ChatProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const [conversations, setConversations] = useState<Conversation[]>(mockConversations);
  const [messagesMap, setMessagesMap] = useState<Record<string, Message[]>>(mockMessagesByConversation);
  const [selectedConversationId, setSelectedConversationId] = useState<string>('conv_1');
  const [searchQuery, setSearchQuery] = useState<string>('');

  const activeConversation = useMemo(() => {
    return conversations.find((c) => c.id === selectedConversationId);
  }, [conversations, selectedConversationId]);

  const activeMessages = useMemo(() => {
    return messagesMap[selectedConversationId] || [];
  }, [messagesMap, selectedConversationId]);

  const totalUnreadCount = useMemo(() => {
    return conversations.reduce((acc, curr) => acc + curr.unreadCount, 0);
  }, [conversations]);

  const filteredConversations = useMemo(() => {
    if (!searchQuery.trim()) return conversations;
    const q = searchQuery.toLowerCase();
    return conversations.filter(
      (c) =>
        c.contact.name.toLowerCase().includes(q) ||
        c.contact.email.toLowerCase().includes(q) ||
        c.contact.role.toLowerCase().includes(q) ||
        c.lastMessage.content.toLowerCase().includes(q)
    );
  }, [conversations, searchQuery]);

  const selectConversation = (id: string) => {
    setSelectedConversationId(id);
    // Mark conversation as read
    setConversations((prev) =>
      prev.map((c) => (c.id === id ? { ...c, unreadCount: 0 } : c))
    );
  };

  const sendMessage = (content: string) => {
    if (!content.trim() || !activeConversation) return;

    const newMessage: Message = {
      id: `msg_${Date.now()}`,
      senderId: user?.id || 'usr_me',
      senderName: user?.name || 'Alex Rivera',
      senderAvatar: user?.avatar,
      receiverId: activeConversation.contact.id,
      content: content.trim(),
      timestamp: new Date().toISOString(),
      status: 'delivered',
      isMe: true,
    };

    // Update messages map
    setMessagesMap((prev) => ({
      ...prev,
      [selectedConversationId]: [...(prev[selectedConversationId] || []), newMessage],
    }));

    // Update conversation last message
    setConversations((prev) =>
      prev.map((c) =>
        c.id === selectedConversationId
          ? {
              ...c,
              lastMessage: {
                content: newMessage.content,
                timestamp: newMessage.timestamp,
                isMe: true,
                status: 'delivered',
              },
            }
          : c
      )
    );

    // Optional simulated mentor response for demonstrational delight
    if (activeConversation.contact.id === 'cnt_1' && content.toLowerCase().includes('phase 1')) {
      setTimeout(() => {
        const replyMsg: Message = {
          id: `msg_reply_${Date.now()}`,
          senderId: activeConversation.contact.id,
          senderName: activeConversation.contact.name,
          senderAvatar: activeConversation.contact.avatar,
          content: "Acknowledged! The Phase 1 frontend interface and layout meet the project specifications perfectly.",
          timestamp: new Date().toISOString(),
          status: 'read',
          isMe: false,
        };

        setMessagesMap((prev) => ({
          ...prev,
          [selectedConversationId]: [...(prev[selectedConversationId] || []), replyMsg],
        }));

        setConversations((prev) =>
          prev.map((c) =>
            c.id === selectedConversationId
              ? {
                  ...c,
                  lastMessage: {
                    content: replyMsg.content,
                    timestamp: replyMsg.timestamp,
                    isMe: false,
                    status: 'read',
                  },
                }
              : c
          )
        );
      }, 1200);
    }
  };

  return (
    <ChatContext.Provider
      value={{
        conversations,
        selectedConversationId,
        activeConversation,
        activeMessages,
        searchQuery,
        setSearchQuery,
        filteredConversations,
        selectConversation,
        sendMessage,
        totalUnreadCount,
      }}
    >
      {children}
    </ChatContext.Provider>
  );
};

export const useChat = (): ChatContextType => {
  const context = useContext(ChatContext);
  if (!context) {
    throw new Error('useChat must be used within a ChatProvider');
  }
  return context;
};
