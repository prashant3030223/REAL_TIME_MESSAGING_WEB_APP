import React, { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  MessageSquare,
  PhoneCall,
  Boxes,
  FolderGit2,
  Settings,
  LogOut,
  Radio,
  ChevronRight,
  Sparkles,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useChat } from '../../context/ChatContext';
import { Avatar } from '../common/Avatar';
import { Badge } from '../common/Badge';
import { ComingSoonModal } from './ComingSoonModal';
import { cn } from '../../utils/cn';

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ isOpen, onClose }) => {
  const { user, logout } = useAuth();
  const { totalUnreadCount } = useChat();
  const navigate = useNavigate();

  const [activeModalFeature, setActiveModalFeature] = useState<{
    name: string;
    phase: string;
    description: string;
    tech: string[];
  } | null>(null);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const navItems = [
    {
      name: 'Dashboard',
      path: '/dashboard',
      icon: LayoutDashboard,
      isImplemented: true,
    },
    {
      name: 'Messages',
      path: '/messages',
      icon: MessageSquare,
      isImplemented: true,
      badge: totalUnreadCount > 0 ? `${totalUnreadCount}` : undefined,
    },
    {
      name: 'Calls',
      path: '#calls',
      icon: PhoneCall,
      isImplemented: false,
      phase: 'Phase 2',
      description: 'Peer-to-peer real-time mesh audio/video conference rooms with dynamic bandwidth adaptation.',
      tech: ['WebRTC', 'MediaStreams API', 'STUN/TURN Mesh', 'Selective Forwarding Unit'],
    },
    {
      name: 'Workspaces',
      path: '#workspaces',
      icon: Boxes,
      isImplemented: false,
      phase: 'Phase 2',
      description: 'Multi-room collaborative channels with real-time state synchronization and live role management.',
      tech: ['Socket.IO Rooms', 'CRDT State Model', 'Distributed Node Mesh'],
    },
    {
      name: 'Files',
      path: '#files',
      icon: FolderGit2,
      isImplemented: false,
      phase: 'Phase 3',
      description: 'Encrypted chunk storage with peer-assisted distribution and content hash verification.',
      tech: ['Content Addressing', 'Chunk Cryptography', 'Chunk P2P Transfer'],
    },
    {
      name: 'Settings',
      path: '#settings',
      icon: Settings,
      isImplemented: false,
      phase: 'Phase 3',
      description: 'Granular node telemetry, security keys, network protocol toggles, and UI preferences.',
      tech: ['Security Configuration', 'Node Diagnostics', 'Theme Preferences'],
    },
  ];

  return (
    <>
      {/* Mobile Backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 lg:hidden"
          onClick={onClose}
        />
      )}

      {/* Sidebar Container */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 w-64 bg-brand-card/95 border-r border-brand-border backdrop-blur-xl',
          'flex flex-col justify-between transition-transform duration-300 ease-in-out lg:translate-x-0',
          isOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full'
        )}
      >
        {/* Brand Header */}
        <div className="h-16 flex items-center justify-between px-5 border-b border-brand-border">
          <NavLink
            to="/dashboard"
            onClick={onClose}
            className="flex items-center gap-3 group focus:outline-none"
          >
            <div className="relative flex items-center justify-center w-9 h-9 rounded-xl bg-gradient-to-tr from-indigo-600 via-indigo-500 to-purple-600 shadow-glow-primary border border-white/20 group-hover:scale-105 transition-transform">
              <Radio className="w-5 h-5 text-white" />
              <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-cyan-400 border-2 border-brand-card animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="font-bold text-base tracking-tight text-white group-hover:text-indigo-300 transition-colors">
                  Connect<span className="text-indigo-400">Sphere</span>
                </span>
              </div>
              <span className="text-[10px] font-medium text-brand-dim tracking-wider uppercase">
                Collaboration Platform
              </span>
            </div>
          </NavLink>
        </div>

        {/* Navigation Section */}
        <div className="flex-1 py-5 px-3 space-y-6 overflow-y-auto">
          {/* Main Navigation Links */}
          <div>
            <div className="px-3 pb-2 text-[11px] font-semibold text-brand-dim uppercase tracking-wider flex items-center justify-between">
              <span>Platform Core</span>
              <Badge variant="cyan" size="sm">Phase 1</Badge>
            </div>
            <nav className="space-y-1">
              {navItems.map((item) => {
                const Icon = item.icon;

                if (item.isImplemented) {
                  return (
                    <NavLink
                      key={item.name}
                      to={item.path}
                      onClick={onClose}
                      className={({ isActive }) =>
                        cn(
                          'flex items-center justify-between px-3.5 py-2.5 rounded-xl text-sm font-medium transition-all group',
                          isActive
                            ? 'bg-gradient-to-r from-indigo-600/20 to-purple-600/10 text-white border border-indigo-500/30 shadow-sm'
                            : 'text-brand-muted hover:text-white hover:bg-brand-surface/70'
                        )
                      }
                    >
                      {({ isActive }) => (
                        <>
                          <div className="flex items-center gap-3">
                            <Icon
                              className={cn(
                                'w-4 h-4 transition-colors',
                                isActive ? 'text-indigo-400' : 'text-brand-dim group-hover:text-brand-muted'
                              )}
                            />
                            <span>{item.name}</span>
                          </div>
                          {item.badge && (
                            <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-indigo-500 text-white shadow-sm">
                              {item.badge}
                            </span>
                          )}
                        </>
                      )}
                    </NavLink>
                  );
                }

                // Coming soon stub button
                return (
                  <button
                    key={item.name}
                    onClick={() => {
                      setActiveModalFeature({
                        name: item.name,
                        phase: item.phase || 'Phase 2',
                        description: item.description || '',
                        tech: item.tech || [],
                      });
                    }}
                    className="w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-sm font-medium text-brand-dim/80 hover:text-brand-text hover:bg-brand-surface/50 transition-all group text-left"
                  >
                    <div className="flex items-center gap-3">
                      <Icon className="w-4 h-4 text-brand-dim group-hover:text-brand-muted" />
                      <span>{item.name}</span>
                    </div>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-brand-surface border border-brand-border text-brand-dim group-hover:border-indigo-500/30 group-hover:text-indigo-300 transition-colors">
                      {item.phase}
                    </span>
                  </button>
                );
              })}
            </nav>
          </div>

          {/* Project Phase Status Card */}
          <div className="mx-1 p-3.5 rounded-xl bg-gradient-to-br from-indigo-950/40 via-brand-surface/60 to-purple-950/30 border border-indigo-500/20 text-left">
            <div className="flex items-center gap-2 mb-1.5">
              <Sparkles className="w-4 h-4 text-indigo-400" />
              <span className="text-xs font-semibold text-white">Project Scope Notice</span>
            </div>
            <p className="text-[11px] text-brand-muted leading-relaxed">
              Demonstration prototype: Currently operating at <strong>25% Phase 1 Frontend Scope</strong>.
            </p>
            <div className="mt-2.5 flex items-center justify-between text-[10px] text-brand-dim">
              <span>Frontend Prototype</span>
              <span className="text-emerald-400 font-medium">Phase 1 Ready</span>
            </div>
          </div>
        </div>

        {/* User Profile Section at Bottom */}
        <div className="p-3 border-t border-brand-border bg-brand-card/90">
          <div className="p-2.5 rounded-xl bg-brand-surface/70 border border-brand-borderLight/20 flex items-center justify-between">
            <div className="flex items-center gap-3 min-w-0">
              <Avatar
                name={user?.name || 'Alex Rivera'}
                src={user?.avatar}
                status={user?.status || 'online'}
                showStatus
                size="sm"
              />
              <div className="min-w-0">
                <p className="text-xs font-semibold text-white truncate">
                  {user?.name || 'Alex Rivera'}
                </p>
                <p className="text-[11px] text-brand-dim truncate">
                  {user?.role || 'Frontend Lead'}
                </p>
              </div>
            </div>

            <button
              onClick={handleLogout}
              title="Sign Out"
              className="p-1.5 rounded-lg text-brand-dim hover:text-red-400 hover:bg-red-500/10 transition-colors"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Feature Coming Soon Roadmap Modal */}
      {activeModalFeature && (
        <ComingSoonModal
          isOpen={!!activeModalFeature}
          onClose={() => setActiveModalFeature(null)}
          featureName={activeModalFeature.name}
          plannedPhase={activeModalFeature.phase}
          description={activeModalFeature.description}
          plannedTech={activeModalFeature.tech}
        />
      )}
    </>
  );
};
