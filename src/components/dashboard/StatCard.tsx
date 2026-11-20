import React from 'react';
import { Card } from '../common/Card';
import { StatMetric } from '../../types';
import { Activity, Users, MessageSquare, ShieldCheck, ArrowUpRight } from 'lucide-react';
import { cn } from '../../utils/cn';

interface StatCardProps {
  stat: StatMetric;
}

export const StatCard: React.FC<StatCardProps> = ({ stat }) => {
  const getIcon = (name: string) => {
    switch (name) {
      case 'Activity':
        return <Activity className="w-5 h-5 text-indigo-400" />;
      case 'Users':
        return <Users className="w-5 h-5 text-cyan-400" />;
      case 'MessageSquare':
        return <MessageSquare className="w-5 h-5 text-purple-400" />;
      case 'ShieldCheck':
        return <ShieldCheck className="w-5 h-5 text-emerald-400" />;
      default:
        return <Activity className="w-5 h-5 text-indigo-400" />;
    }
  };

  const getGlowBg = (name: string) => {
    switch (name) {
      case 'Activity':
        return 'bg-indigo-500/10 border-indigo-500/20';
      case 'Users':
        return 'bg-cyan-500/10 border-cyan-500/20';
      case 'MessageSquare':
        return 'bg-purple-500/10 border-purple-500/20';
      case 'ShieldCheck':
        return 'bg-emerald-500/10 border-emerald-500/20';
      default:
        return 'bg-indigo-500/10 border-indigo-500/20';
    }
  };

  return (
    <Card hoverEffect className="relative overflow-hidden group">
      {/* Decorative gradient blur in top right */}
      <div className="absolute -top-10 -right-10 w-24 h-24 rounded-full bg-indigo-500/5 blur-xl group-hover:bg-indigo-500/10 transition-colors pointer-events-none" />

      <div className="flex items-start justify-between">
        <div className={cn('p-2.5 rounded-xl border', getGlowBg(stat.iconName))}>
          {getIcon(stat.iconName)}
        </div>
        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">
          <ArrowUpRight className="w-3 h-3" />
          {stat.change}
        </span>
      </div>

      <div className="mt-4 text-left">
        <p className="text-xs font-medium text-brand-muted uppercase tracking-wider">{stat.label}</p>
        <h3 className="mt-1 text-2xl font-bold text-white tracking-tight">{stat.value}</h3>
        <p className="mt-1 text-xs text-brand-dim">{stat.subValue}</p>
      </div>
    </Card>
  );
};
