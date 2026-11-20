import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { SystemStatusCard } from '../components/dashboard/SystemStatusCard';
import { StatCard } from '../components/dashboard/StatCard';
import { QuickActionCard } from '../components/dashboard/QuickActionCard';
import { RecentConversationsCard } from '../components/dashboard/RecentConversationsCard';
import { OnlineContactsCard } from '../components/dashboard/OnlineContactsCard';
import { ComingSoonModal } from '../components/layout/ComingSoonModal';
import { mockStatMetrics, mockQuickActions } from '../data/mockData';
import { QuickAction } from '../types';
import { Radio, Zap, Shield, Sparkles, CheckCircle2 } from 'lucide-react';
import { Badge } from '../components/common/Badge';

export const Dashboard: React.FC = () => {
  const { user } = useAuth();
  const [selectedRoadmapAction, setSelectedRoadmapAction] = useState<QuickAction | null>(null);
  const [broadcastNotice, setBroadcastNotice] = useState<string | null>(null);

  const handleSimulateBroadcast = () => {
    setBroadcastNotice('Local broadcast ping transmitted to 6 peer simulation nodes. Latency: 12ms (Phase 1 local state).');
    setTimeout(() => {
      setBroadcastNotice(null);
    }, 4500);
  };

  const getPlannedTechForAction = (actionKey: string): string[] => {
    switch (actionKey) {
      case 'voice-video':
        return ['WebRTC 1.0', 'Audio/Video Tracks', 'Opus Audio Codec', 'ICE STUN/TURN Mesh'];
      case 'whiteboard':
        return ['Yjs Shared CRDT', 'Canvas 2D API', 'Binary State Vectors', 'WebSocket Sync'];
      case 'files':
        return ['Content Hash Addressing', 'AES-256 Block Storage', 'Chunked Transfer', 'Merkle Tree DAG'];
      case 'network':
        return ['D3 / Force-Directed Graph', 'Consensus Telemetry', 'Gossip Protocol Simulation'];
      default:
        return ['Distributed Architecture', 'Phase 2 Protocol'];
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto text-left">
      {/* Broadcast simulation feedback alert */}
      {broadcastNotice && (
        <div className="p-3.5 rounded-xl bg-gradient-to-r from-indigo-900/40 via-purple-900/30 to-brand-card border border-indigo-500/40 text-xs text-white flex items-center justify-between animate-in fade-in duration-200 shadow-glow-primary">
          <div className="flex items-center gap-2.5">
            <Radio className="w-4 h-4 text-cyan-400 animate-pulse shrink-0" />
            <span>{broadcastNotice}</span>
          </div>
          <button
            onClick={() => setBroadcastNotice(null)}
            className="text-brand-dim hover:text-white text-xs underline ml-2"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Welcome & Top Architecture Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-brand-border/60">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight flex items-center gap-2">
            <span>Welcome back, {user?.name?.split(' ')[0] || 'Engineer'}</span>
            <span className="text-xs font-normal text-indigo-400 bg-indigo-500/10 px-2 py-0.5 rounded-full border border-indigo-500/20">
              {user?.workspace || 'Main Cluster'}
            </span>
          </h2>
          <p className="mt-1 text-xs sm:text-sm text-brand-muted">
            ConnectSphere distributed cluster is operational in Phase 1 frontend prototype mode.
          </p>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto">
          <div className="px-3 py-1.5 rounded-lg bg-brand-surface/70 border border-brand-border flex items-center gap-2 text-xs text-brand-dim">
            <span className="w-2 h-2 rounded-full bg-emerald-400" />
            <span>Node Status: <strong className="text-white">Active</strong></span>
          </div>
        </div>
      </div>

      {/* System Status Architecture Card */}
      <SystemStatusCard />

      {/* Telemetry Metrics Grid (4 Stat Cards) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {mockStatMetrics.map((stat) => (
          <StatCard key={stat.id} stat={stat} />
        ))}
      </div>

      {/* Main 2-Column Section: Recent Conversations & Online Contacts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 min-h-[380px]">
          <RecentConversationsCard />
        </div>
        <div className="min-h-[380px]">
          <OnlineContactsCard />
        </div>
      </div>

      {/* Quick Action Cards Section */}
      <div className="space-y-3 pt-2">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-white">Platform Modules & Quick Actions</h3>
            <p className="text-xs text-brand-dim">
              Explore implemented Phase 1 features and upcoming Phase 2/3 specifications.
            </p>
          </div>
          <Badge variant="purple" size="sm">
            Roadmap Overview
          </Badge>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {mockQuickActions.map((action) => (
            <QuickActionCard
              key={action.id}
              action={action}
              onOpenRoadmap={(act) => setSelectedRoadmapAction(act)}
              onSimulateBroadcast={handleSimulateBroadcast}
            />
          ))}
        </div>
      </div>

      {/* Coming Soon Roadmap Modal */}
      {selectedRoadmapAction && (
        <ComingSoonModal
          isOpen={!!selectedRoadmapAction}
          onClose={() => setSelectedRoadmapAction(null)}
          featureName={selectedRoadmapAction.title}
          plannedPhase={selectedRoadmapAction.badge || 'Phase 2 Planned'}
          description={selectedRoadmapAction.description}
          plannedTech={getPlannedTechForAction(selectedRoadmapAction.actionKey)}
        />
      )}
    </div>
  );
};
