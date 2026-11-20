# REAL_TIME_MESSAGING_WEB_APP
## ConnectSphere – Distributed Real-Time Collaboration Platform
### Phase 1 Frontend Prototype (25% Initial Milestone)

### Overview
**ConnectSphere** is an enterprise-grade distributed collaboration platform designed for real-time team communication, distributed workspaces, and peer-to-peer data coordination.

This repository hosts the **Phase 1 Frontend Development** milestone, developed strictly within the defined initial scope to demonstrate core UI/UX architecture, responsive design system, client-side routing, and interactive mock state before initiating Phase 2 protocol-level integrations.

---

### Phase 1 Technology Stack
- **Framework:** React 18 (TypeScript)
- **Build Tool:** Vite
- **Styling:** Tailwind CSS (Dark navy SaaS theme, glassmorphic surfaces, glow effects)
- **Routing:** React Router v6
- **Icons:** Lucide React
- **State Management:** React Context API (`AuthContext`, `ChatContext`)

---

### Project Structure
```text
src/
├── assets/                  # Static platform graphics and assets
├── components/
│   ├── common/              # Reusable atomic UI components
│   │   ├── Avatar.tsx       # Dynamic fallback avatars with status badges
│   │   ├── Badge.tsx        # Styled indicators and phase chips
│   │   ├── Button.tsx       # Variants (primary, secondary, ghost, danger)
│   │   ├── Card.tsx         # Glassmorphic card containers
│   │   ├── Input.tsx        # Styled text/password inputs with validation
│   │   └── Modal.tsx        # Accessible dialog backdrop with Esc listener
│   ├── layout/              # High-level shell components
│   │   ├── AppLayout.tsx    # Responsive shell combining Sidebar and Navbar
│   │   ├── Sidebar.tsx      # Core navigation with Phase 2/3 coming soon modals
│   │   ├── Navbar.tsx       # Search bar, cluster status, notifications dropdown
│   │   └── ComingSoonModal.tsx # Roadmap spec dialog for postponed features
│   ├── dashboard/           # Dashboard module widgets
│   │   ├── StatCard.tsx     # Platform telemetry & metrics
│   │   ├── QuickActionCard.tsx # Module launch pads & roadmap links
│   │   ├── RecentConversationsCard.tsx # Active threads preview
│   │   ├── OnlineContactsCard.tsx      # Peer nodes list
│   │   └── SystemStatusCard.tsx        # Architectural milestone overview
│   └── chat/                # Messaging interface
│       ├── ChatSidebar.tsx  # Searchable & filterable conversations list
│       ├── ConversationItem.tsx # Individual contact card with last message
│       ├── ChatHeader.tsx   # Active contact telemetry and call stubs
│       ├── MessageBubble.tsx # Sender vs receiver bubbles with timestamps & delivery status
│       ├── MessageInput.tsx # Input field with quick demo response chips
│       └── ChatArea.tsx     # Chat viewport with auto-scroll
├── context/
│   ├── AuthContext.tsx      # Client-side session and mock login/register state
│   └── ChatContext.tsx      # Real-time simulated messaging state & filters
├── data/
│   └── mockData.ts          # Realistic contacts, mentors, messages, and metrics
├── types/
│   └── index.ts             # Strict TypeScript definitions
├── utils/
│   ├── cn.ts                # Classnames and Tailwind merge utility
│   └── formatters.ts        # Relative time, timestamps, and initials
├── pages/
│   ├── Login.tsx            # Login page with 1-click demo fills
│   ├── Register.tsx         # Registration page with frontend validation
│   ├── Dashboard.tsx        # Main dashboard telemetry and quick actions
│   ├── Messages.tsx         # Two-column responsive messaging layout
│   └── NotFound.tsx         # 404 fallback page
├── App.tsx                  # Application route definitions
├── main.tsx                 # React DOM mount point
└── index.css                # Global Tailwind directives & dark theme styling
```

---

### Getting Started

#### 1. Install Dependencies
```bash
npm install
```

#### 2. Start Development Server
```bash
npm run dev
```
The application will launch at `http://localhost:3000` (or `http://localhost:5173`).

#### 3. Build for Production
```bash
npm run build
```

---

### Scope Breakdown

#### Features Implemented in Phase 1:
1. **Design System & Branding:**
   - Dark navy / charcoal palette (`#0B0F19`, `#111827`, `#1E293B`)
   - Indigo/purple glowing accents (`#6366F1`, `#8B5CF6`, `#06B6D4`)
   - Fully responsive layout for desktop and mobile viewports.
2. **Authentication Interface (Frontend Mock):**
   - Login page with Remember Me, Show/Hide password toggle, and 1-Click Demo autofill.
   - Registration page with client-side form validation (email format, password matching, length check).
3. **Platform Dashboard:**
   - Left navigation sidebar with active link highlights and notification badges.
   - Top navigation bar with live peer status, search bar, and interactive notifications dropdown.
   - Architectural milestone banner outlining Phase 1 progress.
   - 4 platform telemetry stat cards.
   - Recent conversations card and online peers card with direct click-to-chat routing.
   - Quick action cards with interactive roadmap specifications.
4. **Interactive Messaging UI:**
   - Searchable and filterable conversation list.
   - Chat header with online/away indicators and call stubs.
   - Sender vs. receiver message bubbles with read receipts.
   - Functional message sending with local UI state and interactive response simulation.

#### Features Strictly Postponed to Later Phases:
- Voice & Video Calling (WebRTC, STUN/TURN, SFU mesh) – **Phase 2**
- Shared Collaborative Whiteboard (Yjs CRDT, Canvas API) – **Phase 2**
- Shared Notes & Document Synchronization – **Phase 2**
- Real-Time Network Sockets (Socket.IO, Distributed Consensus) – **Phase 2**
- Distributed File Cluster & Content-Addressed Storage – **Phase 3**
- Backend Database & Microservice APIs – **Phase 3**
