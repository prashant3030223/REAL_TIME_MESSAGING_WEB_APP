import React from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../components/common/Button';
import { Radio, ArrowLeft } from 'lucide-react';

export const NotFound: React.FC = () => {
  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-brand-bg text-center">
      <div className="max-w-md space-y-4">
        <div className="w-16 h-16 mx-auto rounded-2xl bg-brand-surface border border-brand-border flex items-center justify-center text-indigo-400">
          <Radio className="w-8 h-8" />
        </div>
        <h1 className="text-4xl font-extrabold text-white">404</h1>
        <h2 className="text-lg font-bold text-slate-200">Node Route Not Found</h2>
        <p className="text-xs text-brand-muted">
          The requested path does not exist in the ConnectSphere cluster routing table.
        </p>
        <div className="pt-2">
          <Link to="/dashboard">
            <Button variant="primary" leftIcon={<ArrowLeft className="w-4 h-4" />}>
              Return to Dashboard
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
};
