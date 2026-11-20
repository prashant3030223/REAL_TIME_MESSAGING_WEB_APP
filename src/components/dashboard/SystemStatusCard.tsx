import React from 'react';
import { Card } from '../common/Card';
import { Badge } from '../common/Badge';
import {
  Layers,
  CheckCircle2,
  GitBranch,
  ShieldAlert,
  Terminal,
  Cpu,
} from 'lucide-react';

export const SystemStatusCard: React.FC = () => {
  return (
    <Card className="relative overflow-hidden border-indigo-500/20 bg-gradient-to-r from-brand-card via-slate-900 to-indigo-950/30 text-left">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
        <div className="space-y-3 max-w-2xl">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="primary" size="md">
              <Layers className="w-3.5 h-3.5 mr-1" /> Phase 1 Frontend Progress
            </Badge>
            <Badge variant="cyan" size="sm">25% Scope Complete</Badge>
            <span className="text-xs text-brand-dim">College Final Year Capstone Project</span>
          </div>

          <div>
            <h2 className="text-xl md:text-2xl font-bold text-white tracking-tight">
              ConnectSphere – Distributed Real-Time Collaboration Platform
            </h2>
            <p className="mt-1.5 text-xs md:text-sm text-brand-muted leading-relaxed">
              Phase 1 establishes the foundational design system, dark navy SaaS identity, authentication flows,
              dashboard overview, and the messaging interface with interactive local state.
            </p>
          </div>

          {/* Key Deliverables Checkmarks */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1 text-xs text-slate-300">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>React 18 + TypeScript + Vite + Tailwind CSS</span>
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>Login & Registration with Form Validation</span>
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>Dashboard Telemetry & Navigation Layout</span>
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>Interactive Messaging UI & Conversation Search</span>
            </div>
          </div>
        </div>

        {/* Phase Boundary & Mentor Highlights Box */}
        <div className="lg:w-72 rounded-xl bg-brand-surface/80 border border-brand-borderLight/30 p-4 shrink-0 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-white flex items-center gap-1.5">
              <Terminal className="w-3.5 h-3.5 text-indigo-400" /> Phase Boundary
            </span>
            <span className="text-[10px] text-brand-dim">Strict Scope</span>
          </div>

          <div className="space-y-1.5 text-[11px] text-brand-muted">
            <div className="flex items-center justify-between">
              <span>Frontend Shell & UI:</span>
              <strong className="text-emerald-400">Phase 1 (Active)</strong>
            </div>
            <div className="flex items-center justify-between">
              <span>WebRTC & Socket.IO:</span>
              <span className="text-indigo-300">Phase 2 Planned</span>
            </div>
            <div className="flex items-center justify-between">
              <span>CRDT Whiteboard & Notes:</span>
              <span className="text-purple-300">Phase 2 Planned</span>
            </div>
            <div className="flex items-center justify-between">
              <span>P2P File Cluster:</span>
              <span className="text-cyan-300">Phase 3 Planned</span>
            </div>
          </div>

          <div className="pt-2 border-t border-brand-border/60 flex items-center justify-between text-[10px] text-brand-dim">
            <span className="flex items-center gap-1">
              <Cpu className="w-3 h-3 text-brand-dim" /> Node: v24.12
            </span>
            <span className="text-emerald-400 font-medium">Ready for Mentor Review</span>
          </div>
        </div>
      </div>
    </Card>
  );
};
