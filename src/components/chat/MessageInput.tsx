import React, { useState, useRef, useEffect } from 'react';
import { Send, Paperclip, Smile, Sparkles } from 'lucide-react';
import { Button } from '../common/Button';

interface MessageInputProps {
  onSendMessage: (content: string) => void;
  contactName: string;
}

export const MessageInput: React.FC<MessageInputProps> = ({
  onSendMessage,
  contactName,
}) => {
  const [content, setContent] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!content.trim()) return;
    onSendMessage(content);
    setContent('');
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const quickPrompts = [
    "Phase 1 frontend deliverables are ready for review.",
    "Component architecture is modular and scalable.",
    "Dark navy SaaS theme is configured with Tailwind CSS.",
  ];

  return (
    <div className="p-3 md:p-4 border-t border-brand-border bg-brand-card/90">
      {/* Quick response chips for effortless mentor demo */}
      <div className="hidden sm:flex items-center gap-1.5 mb-2 overflow-x-auto pb-1 text-[11px]">
        <span className="text-brand-dim flex items-center gap-1 shrink-0 mr-1">
          <Sparkles className="w-3 h-3 text-indigo-400" /> Demo Presets:
        </span>
        {quickPrompts.map((prompt, idx) => (
          <button
            key={idx}
            type="button"
            onClick={() => {
              setContent(prompt);
              inputRef.current?.focus();
            }}
            className="shrink-0 px-2.5 py-1 rounded-full bg-brand-surface border border-brand-border hover:border-indigo-500/40 hover:bg-brand-surfaceHover text-brand-muted hover:text-white transition-all"
          >
            {prompt}
          </button>
        ))}
      </div>

      <form onSubmit={handleSubmit} className="flex items-center gap-2">
        {/* Attachment button */}
        <button
          type="button"
          title="Attach File (Phase 3 Distributed File Cluster)"
          onClick={() => alert('File transfer is slated for Phase 3 (Distributed Chunk Storage).')}
          className="p-2.5 rounded-xl text-brand-dim hover:text-white hover:bg-brand-surface transition-colors shrink-0"
        >
          <Paperclip className="w-5 h-5" />
        </button>

        {/* Input box */}
        <div className="relative flex-1">
          <input
            ref={inputRef}
            type="text"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={`Message ${contactName}...`}
            className="w-full pl-4 pr-10 py-3 rounded-xl bg-brand-surface border border-brand-border text-sm text-brand-text placeholder-brand-dim focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50 transition-all"
          />
          <button
            type="button"
            title="Emoji selector"
            onClick={() => setContent((prev) => prev + ' 🚀')}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-brand-dim hover:text-white transition-colors"
          >
            <Smile className="w-5 h-5" />
          </button>
        </div>

        {/* Send button */}
        <Button
          type="submit"
          variant="primary"
          size="md"
          disabled={!content.trim()}
          className="h-11 px-4 shrink-0 rounded-xl"
        >
          <Send className="w-4 h-4" />
          <span className="hidden sm:inline">Send</span>
        </Button>
      </form>
    </div>
  );
};
