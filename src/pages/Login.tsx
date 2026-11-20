import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Input } from '../components/common/Input';
import { Button } from '../components/common/Button';
import { Modal } from '../components/common/Modal';
import {
  Radio,
  Mail,
  Lock,
  Eye,
  EyeOff,
  Sparkles,
  ShieldCheck,
  CheckCircle2,
  ArrowRight,
} from 'lucide-react';

export const Login: React.FC = () => {
  const navigate = useNavigate();
  const { login } = useAuth();

  const [email, setEmail] = useState(() => localStorage.getItem('cs_remember_email') || 'alex.rivera@connectsphere.dev');
  const [password, setPassword] = useState('password123');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [errors, setErrors] = useState<{ email?: string; password?: string; general?: string }>({});
  const [forgotModalOpen, setForgotModalOpen] = useState(false);

  const validate = () => {
    const errs: { email?: string; password?: string } = {};
    if (!email.trim()) {
      errs.email = 'Email address is required';
    } else if (!/\S+@\S+\.\S+/.test(email)) {
      errs.email = 'Please enter a valid email address';
    }

    if (!password) {
      errs.password = 'Password is required';
    } else if (password.length < 6) {
      errs.password = 'Password must be at least 6 characters';
    }

    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    setIsLoading(true);
    try {
      await login(email, password, rememberMe);
      navigate('/dashboard');
    } catch {
      setErrors({ general: 'Authentication failed. Please check credentials.' });
    } finally {
      setIsLoading(false);
    }
  };

  const handleQuickFill = (demoEmail: string) => {
    setEmail(demoEmail);
    setPassword('password123');
    setErrors({});
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-brand-bg relative overflow-hidden">
      {/* Background ambient gradient spheres */}
      <div className="absolute top-1/4 -left-20 w-96 h-96 bg-indigo-600/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-1/4 -right-20 w-96 h-96 bg-purple-600/10 rounded-full blur-3xl pointer-events-none" />

      <div className="w-full max-w-md relative z-10">
        {/* Brand Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-tr from-indigo-600 via-indigo-500 to-purple-600 shadow-glow-primary border border-white/20 mb-4 animate-in zoom-in-50 duration-300">
            <Radio className="w-7 h-7 text-white" />
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
            Connect<span className="text-indigo-400">Sphere</span>
          </h1>
          <p className="mt-1.5 text-xs sm:text-sm text-brand-muted">
            Distributed Real-Time Collaboration Platform
          </p>
          <div className="mt-2.5 inline-flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
            <Sparkles className="w-3 h-3" /> Phase 1 Frontend Demonstration
          </div>
        </div>

        {/* Card Form */}
        <div className="p-6 sm:p-8 rounded-2xl bg-brand-card/90 border border-brand-borderLight/20 shadow-2xl backdrop-blur-xl text-left">
          <div className="mb-6">
            <h2 className="text-lg font-bold text-white">Sign In to Platform</h2>
            <p className="text-xs text-brand-dim mt-0.5">
              Access your distributed workspace and active peer channels.
            </p>
          </div>

          {errors.general && (
            <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-xs flex items-center gap-2">
              <span>{errors.general}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              label="Email Address"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="e.g. name@connectsphere.dev"
              leftIcon={<Mail className="w-4 h-4" />}
              error={errors.email}
              autoComplete="email"
            />

            <div>
              <Input
                label="Password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter password"
                leftIcon={<Lock className="w-4 h-4" />}
                rightIcon={
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="p-1 text-brand-dim hover:text-white transition-colors"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                }
                error={errors.password}
                autoComplete="current-password"
              />
            </div>

            <div className="flex items-center justify-between text-xs pt-1">
              <label className="flex items-center gap-2 cursor-pointer select-none text-brand-muted hover:text-white transition-colors">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="w-4 h-4 rounded border-brand-border bg-brand-surface text-indigo-600 focus:ring-indigo-500 focus:ring-offset-brand-card cursor-pointer"
                />
                <span>Remember me</span>
              </label>

              <button
                type="button"
                onClick={() => setForgotModalOpen(true)}
                className="text-indigo-400 hover:text-indigo-300 font-medium transition-colors"
              >
                Forgot password?
              </button>
            </div>

            <Button
              type="submit"
              variant="primary"
              size="lg"
              isLoading={isLoading}
              className="w-full mt-2 font-semibold shadow-glow-primary"
              rightIcon={<ArrowRight className="w-4 h-4" />}
            >
              Sign In to ConnectSphere
            </Button>
          </form>

          {/* Quick Fill Demo Selector */}
          <div className="mt-6 pt-5 border-t border-brand-border/80">
            <p className="text-[11px] font-semibold text-brand-dim uppercase tracking-wider mb-2.5 flex items-center justify-between">
              <span>Quick Demo Sign-In:</span>
              <span className="text-indigo-400 font-normal">1-Click</span>
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => handleQuickFill('alex.rivera@connectsphere.dev')}
                className="px-2.5 py-1.5 rounded-lg bg-brand-surface hover:bg-brand-surfaceHover border border-brand-border text-left transition-colors"
              >
                <div className="text-[11px] font-medium text-white truncate">Alex Rivera</div>
                <div className="text-[10px] text-indigo-400 truncate">Student Lead</div>
              </button>
              <button
                type="button"
                onClick={() => handleQuickFill('evelyn.vance@university.edu')}
                className="px-2.5 py-1.5 rounded-lg bg-brand-surface hover:bg-brand-surfaceHover border border-brand-border text-left transition-colors"
              >
                <div className="text-[11px] font-medium text-white truncate">Dr. E. Vance</div>
                <div className="text-[10px] text-cyan-400 truncate">Project Mentor</div>
              </button>
            </div>
          </div>

          {/* Registration Navigation Link */}
          <div className="mt-6 text-center text-xs text-brand-muted">
            Don't have an account yet?{' '}
            <Link
              to="/register"
              className="font-semibold text-indigo-400 hover:text-indigo-300 hover:underline transition-colors"
            >
              Create Account
            </Link>
          </div>
        </div>

        {/* Footnote */}
        <p className="mt-6 text-center text-[11px] text-brand-dim flex items-center justify-center gap-1.5">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
          <span>ConnectSphere Phase 1 &bull; Frontend Local State</span>
        </p>
      </div>

      {/* Forgot Password Modal */}
      <Modal
        isOpen={forgotModalOpen}
        onClose={() => setForgotModalOpen(false)}
        title="Reset Password Notice"
        description="ConnectSphere Security Layer"
      >
        <div className="space-y-4 text-left">
          <p className="text-xs text-brand-muted leading-relaxed">
            In Phase 1, password resets operate within local mock authentication. You can sign in using any email and password with at least 6 characters, or click either of the 1-click demo buttons on the login card.
          </p>
          <div className="p-3 rounded-lg bg-indigo-500/10 border border-indigo-500/20 text-xs text-indigo-300">
            <strong>Default password:</strong> <code>password123</code>
          </div>
          <div className="flex justify-end">
            <Button variant="primary" size="md" onClick={() => setForgotModalOpen(false)}>
              Got it
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};
