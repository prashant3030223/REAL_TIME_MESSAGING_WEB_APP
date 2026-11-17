import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Card } from '../common/Card';
import { Avatar } from '../common/Avatar';
import { mockContacts } from '../../data/mockData';
import { useChat } from '../../context/ChatContext';
import { Users, Send } from 'lucide-react';

export const OnlineContactsCard: React.FC = () => {
  const { conversations, selectConversation } = useChat();
  const navigate = useNavigate();

  const handleStartChatWithContact = (contactId: string) => {
    // Check if conversation exists
    const existing = conversations.find((c) => c.contact.id === contactId);
    if (existing) {
      selectConversation(existing.id);
    }
    navigate('/messages');
  };

  const onlineContacts = mockContacts.filter((c) => c.status === 'online' || c.status === 'busy');

  return (
    <Card className="text-left flex flex-col h-full">
      <div className="flex items-center justify-between pb-4 border-b border-brand-border">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-lg bg-cyan-500/10 border border-cyan-500/20 text-cyan-400">
            <Users className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-white">Online Peers & Mentors</h3>
            <p className="text-xs text-brand-dim">{onlineContacts.length} nodes actively connected</p>
          </div>
        </div>
      </div>

      <div className="divide-y divide-brand-border/60 flex-1 overflow-y-auto">
        {mockContacts.slice(0, 5).map((contact) => (
          <div
            key={contact.id}
            className="py-3 px-1 flex items-center justify-between hover:bg-brand-surface/40 rounded-lg transition-colors group"
          >
            <div className="flex items-center gap-3 min-w-0">
              <Avatar
                name={contact.name}
                src={contact.avatar}
                status={contact.status}
                showStatus
                size="md"
              />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-white group-hover:text-cyan-300 transition-colors truncate">
                  {contact.name}
                </p>
                <p className="text-xs text-brand-muted truncate">{contact.role}</p>
                <span className="text-[10px] text-brand-dim">{contact.department}</span>
              </div>
            </div>

            <button
              onClick={() => handleStartChatWithContact(contact.id)}
              className="p-2 rounded-lg bg-brand-surface text-brand-muted hover:text-white hover:bg-indigo-600 transition-all opacity-80 group-hover:opacity-100"
              title="Message Contact"
            >
              <Send className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>
    </Card>
  );
};
