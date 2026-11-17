import React, { useState, useRef, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import {
  Menu,
  Search,
  Bell,
  CheckCircle2,
  Cpu,
  Radio,
  Layers,
  Sparkles,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { mockNotifications } from '../../data/mockData';
import { Avatar } from '../common/Avatar';
import { Badge } from '../common/Badge';
import { cn } from '../../utils/cn';

interface NavbarProps {
  onToggleSidebar: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({ onToggleSidebar }) => {
  const { user } = useAuth();
  const location = useLocation();
  const [showNotifications, setShowNotifications] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close notifications dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowNotifications(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const getPageTitle = () => {
    switch (location.pathname) {
      case '/dashboard':
        return {
          title: 'Project Overview',
          subtitle: 'Distributed platform telemetry and quick actions',
        };
      case '/messages':
        return {
          title: 'Real-Time Messaging',
          subtitle: 'Interactive prototype with instant message delivery',
        };
      default:
        return {
          title: 'ConnectSphere',
          subtitle: 'Distributed Collaboration Platform',
        };
    }
  };

  const { title, subtitle } = getPageTitle();
  const unreadNotifsCount = mockNotifications.filter((n) => n.unread).length;

  return (
    <header className="h-16 px-4 md:px-8 border-b border-brand-border bg-brand-card/80 backdrop-blur-xl sticky top-0 z-30 flex items-center justify-between">
      {/* Left: Mobile hamburger + Page Title */}
      <div className="flex items-center gap-4">
        <button
          onClick={onToggleSidebar}
          aria-label="Toggle navigation menu"
          className="lg:hidden p-2 rounded-lg text-brand-muted hover:text-white hover:bg-brand-surface transition-colors"
        >
          <Menu className="w-5 h-5" />
        </button>

        <div className="text-left">
          <div className="flex items-center gap-2.5">
            <h1 className="text-base md:text-lg font-bold text-white tracking-tight">
              {title}
            </h1>
            <Badge variant="cyan" size="sm" dot className="hidden sm:inline-flex">
              Phase 1 Live
            </Badge>
          </div>
          <p className="hidden md:block text-xs text-brand-dim">{subtitle}</p>
        </div>
      </div>

      {/* Right: Search + Phase Badge + Notifications + User Avatar */}
      <div className="flex items-center gap-3">
        {/* Search bar (desktop) */}
        <div className="relative hidden md:flex items-center">
          <Search className="w-4 h-4 text-brand-dim absolute left-3 pointer-events-none" />
          <input
            type="text"
            placeholder="Search platform (Ctrl+K)..."
            className="w-56 lg:w-64 pl-9 pr-3 py-1.5 rounded-lg bg-brand-surface/70 border border-brand-border text-xs text-brand-text placeholder-brand-dim outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50 transition-all"
          />
        </div>

        {/* Distributed Cluster Status Indicator */}
        <div className="hidden lg:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-brand-surface/50 border border-brand-border text-xs text-brand-muted">
          <Radio className="w-3.5 h-3.5 text-emerald-400 animate-pulse" />
          <span>Local Mesh: <strong className="text-white">Active</strong></span>
        </div>

        {/* Notifications Dropdown */}
        <div className="relative" ref={dropdownRef}>
          <button
            onClick={() => setShowNotifications(!showNotifications)}
            className="relative p-2 rounded-lg text-brand-muted hover:text-white hover:bg-brand-surface transition-colors"
            title="Notifications"
          >
            <Bell className="w-5 h-5" />
            {unreadNotifsCount > 0 && (
              <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-indigo-500 animate-ping" />
            )}
            {unreadNotifsCount > 0 && (
              <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-indigo-500" />
            )}
          </button>

          {showNotifications && (
            <div className="absolute right-0 mt-2 w-80 sm:w-96 rounded-xl bg-brand-card border border-brand-borderLight/30 shadow-2xl p-4 z-50 text-left animate-in fade-in duration-150">
              <div className="flex items-center justify-between pb-3 border-b border-brand-border">
                <div className="flex items-center gap-2">
                  <h4 className="text-sm font-semibold text-white">Platform Notifications</h4>
                  <Badge variant="primary" size="sm">{unreadNotifsCount} new</Badge>
                </div>
                <span className="text-[11px] text-brand-dim">Phase 1 Demo</span>
              </div>

              <div className="mt-3 space-y-2.5 max-h-72 overflow-y-auto pr-1">
                {mockNotifications.map((n) => (
                  <div
                    key={n.id}
                    className={cn(
                      'p-2.5 rounded-lg border text-xs transition-colors',
                      n.unread
                        ? 'bg-indigo-950/20 border-indigo-500/30 text-brand-text'
                        : 'bg-brand-surface/40 border-brand-border/60 text-brand-muted'
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-white">{n.title}</span>
                      <span className="text-[10px] text-brand-dim">{n.timestamp}</span>
                    </div>
                    <p className="mt-1 text-brand-muted leading-relaxed">{n.description}</p>
                  </div>
                ))}
              </div>

              <div className="mt-3 pt-2 border-t border-brand-border flex items-center justify-between text-[11px] text-brand-dim">
                <span>Frontend prototype notices</span>
                <span className="text-indigo-400 hover:underline cursor-pointer">Mark all as read</span>
              </div>
            </div>
          )}
        </div>

        {/* User Pill */}
        <div className="flex items-center gap-2 pl-2 border-l border-brand-border">
          <Avatar
            name={user?.name || 'Alex Rivera'}
            src={user?.avatar}
            status={user?.status || 'online'}
            showStatus
            size="sm"
          />
          <div className="hidden xl:block text-left">
            <p className="text-xs font-medium text-white leading-tight">
              {user?.name || 'Alex Rivera'}
            </p>
            <p className="text-[10px] text-indigo-400 leading-tight">
              {user?.role || 'Frontend Lead'}
            </p>
          </div>
        </div>
      </div>
    </header>
  );
};
