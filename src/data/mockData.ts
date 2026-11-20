import { User, Contact, Conversation, Message, StatMetric, QuickAction, NotificationItem } from '../types';

export const currentUser: User = {
  id: 'usr_me',
  name: 'Alex Rivera',
  email: 'alex.rivera@connectsphere.dev',
  avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
  role: 'Frontend Lead & Core Engineer',
  title: 'Lead Architect',
  status: 'online',
  workspace: 'ConnectSphere Main Cluster'
};

export const mockContacts: Contact[] = [
  {
    id: 'cnt_1',
    name: 'Dr. Evelyn Vance',
    email: 'evelyn.vance@university.edu',
    avatar: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=150&auto=format&fit=crop&q=80',
    status: 'online',
    role: 'Project Mentor & Advisor',
    department: 'Distributed Computing Lab'
  },
  {
    id: 'cnt_2',
    name: 'Marcus Sterling',
    email: 'marcus.s@connectsphere.dev',
    avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80',
    status: 'online',
    role: 'Distributed Backend & Consensus',
    department: 'Core Infrastructure'
  },
  {
    id: 'cnt_3',
    name: 'Sophia Zhang',
    email: 'sophia.z@connectsphere.dev',
    avatar: 'https://images.unsplash.com/photo-1580489944761-15a19d654956?w=150&auto=format&fit=crop&q=80',
    status: 'away',
    lastSeen: '15m ago',
    role: 'CRDT & Real-Time Sync Specialist',
    department: 'Data Protocol'
  },
  {
    id: 'cnt_4',
    name: 'David Kim',
    email: 'david.k@connectsphere.dev',
    avatar: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=150&auto=format&fit=crop&q=80',
    status: 'offline',
    lastSeen: '2 hours ago',
    role: 'WebRTC & Media Protocol Engineer',
    department: 'Network Operations'
  },
  {
    id: 'cnt_5',
    name: 'Elena Rostova',
    email: 'elena.r@connectsphere.dev',
    avatar: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=150&auto=format&fit=crop&q=80',
    status: 'online',
    role: 'Security & P2P Encryption Analyst',
    department: 'Cybersecurity Lab'
  },
  {
    id: 'cnt_6',
    name: 'Kavita Sharma',
    email: 'kavita.s@connectsphere.dev',
    avatar: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150&auto=format&fit=crop&q=80',
    status: 'busy',
    role: 'Quality & Benchmarking Engineer',
    department: 'Evaluation Team'
  }
];

export const mockConversations: Conversation[] = [
  {
    id: 'conv_1',
    contact: mockContacts[0], // Dr. Evelyn Vance
    lastMessage: {
      content: "Please ensure the Phase 1 architectural blueprint highlights our distributed modular design.",
      timestamp: new Date(Date.now() - 8 * 60 * 1000).toISOString(),
      isMe: false,
      status: 'read'
    },
    unreadCount: 1,
    isPinned: true
  },
  {
    id: 'conv_2',
    contact: mockContacts[1], // Marcus Sterling
    lastMessage: {
      content: "Frontend components look super sharp. I'm finishing the consensus simulation specs.",
      timestamp: new Date(Date.now() - 42 * 60 * 1000).toISOString(),
      isMe: true,
      status: 'read'
    },
    unreadCount: 0,
    isPinned: true
  },
  {
    id: 'conv_3',
    contact: mockContacts[2], // Sophia Zhang
    lastMessage: {
      content: "I reviewed the state synchronization plan for Phase 2. The data structure aligns well.",
      timestamp: new Date(Date.now() - 3 * 3600 * 1000).toISOString(),
      isMe: false,
      status: 'delivered'
    },
    unreadCount: 0
  },
  {
    id: 'conv_4',
    contact: mockContacts[4], // Elena Rostova
    lastMessage: {
      content: "Are we using AES-GCM or ChaCha20 for peer key exchange in later phases?",
      timestamp: new Date(Date.now() - 22 * 3600 * 1000).toISOString(),
      isMe: false,
      status: 'read'
    },
    unreadCount: 0
  },
  {
    id: 'conv_5',
    contact: mockContacts[3], // David Kim
    lastMessage: {
      content: "Pushed the network topology draft to our internal docs repo.",
      timestamp: new Date(Date.now() - 28 * 3600 * 1000).toISOString(),
      isMe: true,
      status: 'delivered'
    },
    unreadCount: 0
  }
];

export const mockMessagesByConversation: Record<string, Message[]> = {
  conv_1: [
    {
      id: 'msg_1_1',
      senderId: 'cnt_1',
      senderName: 'Dr. Evelyn Vance',
      senderAvatar: mockContacts[0].avatar,
      content: "Hello Alex, good afternoon. How is the initial Phase 1 frontend progress coming along?",
      timestamp: new Date(Date.now() - 35 * 60 * 1000).toISOString(),
      status: 'read',
      isMe: false
    },
    {
      id: 'msg_1_2',
      senderId: 'usr_me',
      senderName: 'Alex Rivera',
      content: "Hi Dr. Vance! The Phase 1 foundation is ready. We have configured React 18, TypeScript, Tailwind CSS, our custom dark navy branding, auth flows, and the core dashboard and messaging layouts.",
      timestamp: new Date(Date.now() - 25 * 60 * 1000).toISOString(),
      status: 'read',
      isMe: true
    },
    {
      id: 'msg_1_3',
      senderId: 'cnt_1',
      senderName: 'Dr. Evelyn Vance',
      senderAvatar: mockContacts[0].avatar,
      content: "Excellent work maintaining strict scope. Keeping Phase 1 dedicated to high-fidelity interface design and modular component architecture will make our Phase 2 real-time integration seamless.",
      timestamp: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
      status: 'read',
      isMe: false
    },
    {
      id: 'msg_1_4',
      senderId: 'cnt_1',
      senderName: 'Dr. Evelyn Vance',
      senderAvatar: mockContacts[0].avatar,
      content: "Please ensure the Phase 1 architectural blueprint highlights our distributed modular design during tomorrow's review.",
      timestamp: new Date(Date.now() - 8 * 60 * 1000).toISOString(),
      status: 'read',
      isMe: false
    }
  ],
  conv_2: [
    {
      id: 'msg_2_1',
      senderId: 'cnt_2',
      senderName: 'Marcus Sterling',
      senderAvatar: mockContacts[1].avatar,
      content: "Hey Alex! Check out the simulated distributed heartbeat in our node specs.",
      timestamp: new Date(Date.now() - 90 * 60 * 1000).toISOString(),
      status: 'read',
      isMe: false
    },
    {
      id: 'msg_2_2',
      senderId: 'usr_me',
      senderName: 'Alex Rivera',
      content: "Awesome, I checked it. For now on the frontend I built our UI component library and dashboard telemetry cards.",
      timestamp: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      status: 'read',
      isMe: true
    },
    {
      id: 'msg_2_3',
      senderId: 'cnt_2',
      senderName: 'Marcus Sterling',
      senderAvatar: mockContacts[1].avatar,
      content: "Frontend components look super sharp. I'm finishing the consensus simulation specs.",
      timestamp: new Date(Date.now() - 42 * 60 * 1000).toISOString(),
      status: 'read',
      isMe: false
    }
  ],
  conv_3: [
    {
      id: 'msg_3_1',
      senderId: 'cnt_3',
      senderName: 'Sophia Zhang',
      senderAvatar: mockContacts[2].avatar,
      content: "I reviewed the state synchronization plan for Phase 2. The data structure aligns well.",
      timestamp: new Date(Date.now() - 3 * 3600 * 1000).toISOString(),
      status: 'read',
      isMe: false
    }
  ],
  conv_4: [
    {
      id: 'msg_4_1',
      senderId: 'cnt_4',
      senderName: 'Elena Rostova',
      senderAvatar: mockContacts[4].avatar,
      content: "Are we using AES-GCM or ChaCha20 for peer key exchange in later phases?",
      timestamp: new Date(Date.now() - 22 * 3600 * 1000).toISOString(),
      status: 'read',
      isMe: false
    }
  ],
  conv_5: [
    {
      id: 'msg_5_1',
      senderId: 'usr_me',
      senderName: 'Alex Rivera',
      content: "Pushed the network topology draft to our internal docs repo.",
      timestamp: new Date(Date.now() - 28 * 3600 * 1000).toISOString(),
      status: 'read',
      isMe: true
    }
  ]
};

export const mockStatMetrics: StatMetric[] = [
  {
    id: 'stat_1',
    label: 'Platform Status',
    value: 'Phase 1 Active',
    subValue: 'UI Prototype (25% Built)',
    change: 'On Schedule',
    isPositive: true,
    iconName: 'Activity'
  },
  {
    id: 'stat_2',
    label: 'Online Peers',
    value: '6 Contacts',
    subValue: 'Distributed team members',
    change: '+2 from morning',
    isPositive: true,
    iconName: 'Users'
  },
  {
    id: 'stat_3',
    label: 'Active Conversations',
    value: '5 Threads',
    subValue: '1 Unread high priority',
    change: 'Up to date',
    isPositive: true,
    iconName: 'MessageSquare'
  },
  {
    id: 'stat_4',
    label: 'Workspace Security',
    value: 'Isolated Cluster',
    subValue: 'Zero-trust architecture',
    change: 'Verified',
    isPositive: true,
    iconName: 'ShieldCheck'
  }
];

export const mockQuickActions: QuickAction[] = [
  {
    id: 'qa_1',
    title: 'Open Chat Room',
    description: 'Jump directly to real-time conversation threads with team members',
    icon: 'MessageSquare',
    badge: 'Available',
    isAvailableInPhase1: true,
    actionKey: '/messages'
  },
  {
    id: 'qa_2',
    title: 'Simulate Broadcast',
    description: 'Test interactive UI state and local messaging latency',
    icon: 'Radio',
    badge: 'Phase 1 Demo',
    isAvailableInPhase1: true,
    actionKey: 'simulate-broadcast'
  },
  {
    id: 'qa_3',
    title: 'Start Voice & Video Call',
    description: 'Mesh WebRTC media mesh with peer-to-peer streaming',
    icon: 'Video',
    badge: 'Phase 2 Planned',
    isAvailableInPhase1: false,
    actionKey: 'voice-video'
  },
  {
    id: 'qa_4',
    title: 'Shared CRDT Whiteboard',
    description: 'Infinite collaborative canvas powered by conflict-free replicated data',
    icon: 'LayoutGrid',
    badge: 'Phase 2 Planned',
    isAvailableInPhase1: false,
    actionKey: 'whiteboard'
  },
  {
    id: 'qa_5',
    title: 'Distributed File Cluster',
    description: 'Content-addressable encrypted chunk storage system',
    icon: 'HardDrive',
    badge: 'Phase 3 Planned',
    isAvailableInPhase1: false,
    actionKey: 'files'
  },
  {
    id: 'qa_6',
    title: 'Cluster Topology Map',
    description: 'Inspect live peer nodes, latency graph, and consensus state',
    icon: 'Network',
    badge: 'Phase 3 Planned',
    isAvailableInPhase1: false,
    actionKey: 'network'
  }
];

export const mockNotifications: NotificationItem[] = [
  {
    id: 'notif_1',
    title: 'Mentor Feedback Received',
    description: 'Dr. Evelyn Vance sent feedback on Phase 1 frontend deliverables.',
    timestamp: '8m ago',
    unread: true,
    type: 'message'
  },
  {
    id: 'notif_2',
    title: 'Local Session Initialized',
    description: 'ConnectSphere frontend client loaded in demo environment.',
    timestamp: '25m ago',
    unread: false,
    type: 'system'
  },
  {
    id: 'notif_3',
    title: 'Phase 2 Roadmap Locked',
    description: 'WebRTC and Socket.IO protocol schemas slated for development next.',
    timestamp: '2h ago',
    unread: false,
    type: 'alert'
  }
];
