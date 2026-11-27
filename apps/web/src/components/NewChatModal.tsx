import { useState } from "react";
import type { FormEvent } from "react";
import { MessageSquarePlus, X, Phone, User, Search, Send } from "lucide-react";
import type { Conversation } from "../services/types.js";

type NewChatModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onStartConversation: (conv: Conversation) => void;
};

export function NewChatModal({ isOpen, onClose, onStartConversation }: NewChatModalProps) {
  const [contactName, setContactName] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  if (!isOpen) return null;

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setErrorMsg("");

    const cleanPhone = phoneNumber.replace(/\D/g, "");
    if (cleanPhone.length !== 10) {
      setErrorMsg("Please enter a valid 10-digit mobile number.");
      return;
    }

    if (!contactName.trim()) {
      setErrorMsg("Please enter contact name.");
      return;
    }

    const convId = `conv-${cleanPhone}`;
    const newConv: Conversation = {
      id: convId,
      type: "direct",
      name: contactName.trim(),
      avatar: `https://api.dicebear.com/7.x/bottts/svg?seed=${cleanPhone}`,
      isOnline: true,
      unreadCount: 0,
      description: `Mobile: +91 ${cleanPhone}`,
    };

    onStartConversation(newConv);
    onClose();
    setContactName("");
    setPhoneNumber("");
  }

  return (
    <div className="modal-backdrop">
      <div className="modal-card new-chat-modal-card">
        <div className="new-chat-header">
          <div className="title-with-icon">
            <MessageSquarePlus size={22} className="text-accent" />
            <h3>Start New Conversation</h3>
          </div>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <p className="new-chat-sub">
          Enter any mobile number to start a real-time messaging, audio, and video session.
        </p>

        {errorMsg && (
          <div className="wa-auth-error-banner" role="alert">
            <span>{errorMsg}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="new-chat-form">
          <div className="wa-field-group">
            <label htmlFor="new-chat-name" className="wa-input-label">Contact / Peer Name</label>
            <div className="input-with-icon">
              <User size={18} className="field-icon" />
              <input
                id="new-chat-name"
                type="text"
                className="wa-text-input"
                placeholder="e.g. Prashant or Rahul"
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
                autoFocus
                required
              />
            </div>
          </div>

          <div className="wa-field-group">
            <label htmlFor="new-chat-phone" className="wa-input-label">10-Digit Mobile Number</label>
            <div className="input-with-icon">
              <Phone size={18} className="field-icon" />
              <input
                id="new-chat-phone"
                type="tel"
                className="wa-text-input"
                placeholder="97569 96666"
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                maxLength={14}
                required
              />
            </div>
          </div>

          <div className="new-chat-actions">
            <button type="button" className="secondary-action-btn" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="primary-action-btn">
              <Send size={16} /> Start Chat
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
