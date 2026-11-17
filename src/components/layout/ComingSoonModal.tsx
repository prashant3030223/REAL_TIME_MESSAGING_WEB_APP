import React from 'react';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';
import { Badge } from '../common/Badge';
import { Layers, CheckCircle2, Clock, ShieldCheck } from 'lucide-react';

interface ComingSoonModalProps {
  isOpen: boolean;
  onClose: () => void;
  featureName: string;
  plannedPhase: string;
  description: string;
  plannedTech: string[];
}

export const ComingSoonModal: React.FC<ComingSoonModalProps> = ({
  isOpen,
  onClose,
  featureName,
  plannedPhase,
  description,
  plannedTech,
}) => {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`${featureName}`}
      description="Feature Phase Roadmap Specification"
    >
      <div className="space-y-4 text-left">
        <div className="flex items-center justify-between p-3 rounded-lg bg-brand-surface/60 border border-brand-border">
          <span className="text-xs text-brand-muted">Development Phase:</span>
          <Badge variant="purple" size="md">
            {plannedPhase}
          </Badge>
        </div>

        <div>
          <h4 className="text-xs font-semibold text-brand-muted uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5 text-indigo-400" /> Phase Description
          </h4>
          <p className="text-sm text-brand-text/90 leading-relaxed bg-brand-bg/50 p-3 rounded-lg border border-brand-border/60">
            {description}
          </p>
        </div>

        <div>
          <h4 className="text-xs font-semibold text-brand-muted uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5 text-cyan-400" /> Planned Technologies (Strictly Phase 2/3)
          </h4>
          <div className="flex flex-wrap gap-1.5">
            {plannedTech.map((tech) => (
              <span
                key={tech}
                className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-md bg-indigo-500/10 text-indigo-300 border border-indigo-500/20"
              >
                <CheckCircle2 className="w-3 h-3 text-indigo-400" /> {tech}
              </span>
            ))}
          </div>
        </div>

        <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-start gap-2.5">
          <ShieldCheck className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" />
          <p className="text-xs text-emerald-300/90 leading-relaxed">
            <strong>Phase 1 Scope Isolation:</strong> Unfinished stubs are intentionally locked in Phase 1 to guarantee high architectural fidelity for the core UI and messaging layout.
          </p>
        </div>

        <div className="pt-2 flex justify-end">
          <Button variant="primary" size="md" onClick={onClose}>
            Understood
          </Button>
        </div>
      </div>
    </Modal>
  );
};
