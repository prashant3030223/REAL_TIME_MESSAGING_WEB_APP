import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Card } from '../common/Card';
import { Badge } from '../common/Badge';
import { QuickAction } from '../../types';
import {
  MessageSquare,
  Radio,
  Video,
  LayoutGrid,
  HardDrive,
  Network,
  ArrowRight,
  Lock,
} from 'lucide-react';
import { cn } from '../../utils/cn';

interface QuickActionCardProps {
  action: QuickAction;
  onOpenRoadmap: (action: QuickAction) => void;
  onSimulateBroadcast?: () => void;
}

export const QuickActionCard: React.FC<QuickActionCardProps> = ({
  action,
  onOpenRoadmap,
  onSimulateBroadcast,
}) => {
  const navigate = useNavigate();

  const getActionIcon = (name: string) => {
    switch (name) {
      case 'MessageSquare':
        return <MessageSquare className="w-5 h-5 text-indigo-400" />;
      case 'Radio':
        return <Radio className="w-5 h-5 text-cyan-400" />;
      case 'Video':
        return <Video className="w-5 h-5 text-purple-400" />;
      case 'LayoutGrid':
        return <LayoutGrid className="w-5 h-5 text-emerald-400" />;
      case 'HardDrive':
        return <HardDrive className="w-5 h-5 text-amber-400" />;
      case 'Network':
        return <Network className="w-5 h-5 text-rose-400" />;
      default:
        return <MessageSquare className="w-5 h-5 text-indigo-400" />;
    }
  };

  const handleClick = () => {
    if (action.actionKey === '/messages') {
      navigate('/messages');
    } else if (action.actionKey === 'simulate-broadcast') {
      if (onSimulateBroadcast) {
        onSimulateBroadcast();
      }
    } else {
      onOpenRoadmap(action);
    }
  };

  return (
    <Card
      hoverEffect
      onClick={handleClick}
      className={cn(
        'cursor-pointer transition-all duration-200 text-left flex flex-col justify-between group',
        !action.isAvailableInPhase1 && 'opacity-80 hover:opacity-100 border-dashed'
      )}
    >
      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="p-2.5 rounded-xl bg-brand-surface border border-brand-borderLight/30 group-hover:scale-105 transition-transform">
            {getActionIcon(action.icon)}
          </div>
          <Badge
            variant={action.isAvailableInPhase1 ? 'primary' : 'neutral'}
            size="sm"
          >
            {!action.isAvailableInPhase1 && <Lock className="w-2.5 h-2.5 inline mr-1" />}
            {action.badge || 'Action'}
          </Badge>
        </div>

        <h4 className="text-sm font-semibold text-white group-hover:text-indigo-300 transition-colors">
          {action.title}
        </h4>
        <p className="mt-1 text-xs text-brand-muted line-clamp-2 leading-relaxed">
          {action.description}
        </p>
      </div>

      <div className="mt-4 pt-3 border-t border-brand-border/60 flex items-center justify-between text-xs font-medium text-brand-dim group-hover:text-indigo-400 transition-colors">
        <span>{action.isAvailableInPhase1 ? 'Launch Feature' : 'View Planned Spec'}</span>
        <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" />
      </div>
    </Card>
  );
};
