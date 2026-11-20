export type UserStatus = 'online' | 'offline' | 'away' | 'busy';

export interface User {
  id: string;
  name: string;
  email: string;
  avatar: string;
  role: string;
  title: string;
  status: UserStatus;
  workspace: string;
}

export interface Contact {
  id: string;
  name: string;
  email: string;
  avatar: string;
  status: UserStatus;
  lastSeen?: string;
  role: string;
  department: string;
}

export type MessageDeliveryStatus = 'sent' | 'delivered' | 'read';

export interface Message {
  id: string;
  senderId: string;
  senderName: string;
  senderAvatar?: string;
  receiverId?: string;
  content: string;
  timestamp: string;
  status: MessageDeliveryStatus;
  isMe: boolean;
}

export interface Conversation {
  id: string;
  contact: Contact;
  lastMessage: {
    content: string;
    timestamp: string;
    isMe: boolean;
    status?: MessageDeliveryStatus;
  };
  unreadCount: number;
  isPinned?: boolean;
}

export interface StatMetric {
  id: string;
  label: string;
  value: string;
  subValue: string;
  change: string;
  isPositive: boolean;
  iconName: string;
}

export interface QuickAction {
  id: string;
  title: string;
  description: string;
  icon: string;
  badge?: string;
  isAvailableInPhase1: boolean;
  actionKey: string;
}

export interface NotificationItem {
  id: string;
  title: string;
  description: string;
  timestamp: string;
  unread: boolean;
  type: 'message' | 'system' | 'alert';
}
