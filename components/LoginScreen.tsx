import React, { useState } from 'react';
import { Mail, Shield, Zap, BarChart, CheckCircle2, ArrowRight, Lock, AlertCircle } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { ApiError } from '../services/apiClient';
import { Button, Card } from '../src/design/ui';

type Mode = 'LOGIN' | 'SIGNUP';

const LoginScreen: React.FC = () => {
  const { login, signup } = useAuth();
  const [mode, setMode] = useState<Mode>('LOGIN');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      if (mode === 'LOGIN') {
        await login(email, password);
      } else {
        await signup(email, password);
      }
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Something went wrong. Please try again.';
      setError(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="h-full bg-noir flex flex-col lg:flex-row font-sans overflow-y-auto">
      {/* Left Side - Hero / Info */}
      <div className="flex-1 shrink-0 bg-gradient-to-br from-[#0a0a0a] via-[#0a0a2a] to-[#0a0a0a] p-8 lg:p-16 flex flex-col justify-between text-white relative overflow-hidden">
        <div className="absolute top-0 left-0 w-64 h-64 bg-volt/10 rounded-full -translate-x-1/2 -translate-y-1/2 blur-3xl animate-float" />
        <div className="absolute bottom-0 right-0 w-96 h-96 bg-volt/10 rounded-full translate-x-1/3 translate-y-1/3 blur-3xl animate-float-delayed" />
        <div className="absolute top-1/2 left-1/2 w-full h-full bg-volt/5 rounded-full -translate-x-1/2 -translate-y-1/2 blur-3xl animate-pulse-slow pointer-events-none" />

        <div className="relative z-10">
          <div className="flex items-center justify-between mb-12 animate-slide-up" style={{ animationDelay: '0.1s' }}>
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 bg-white/10 backdrop-blur-md rounded-xl flex items-center justify-center border border-white/20">
                <Mail className="w-6 h-6 text-white" />
              </div>
              <span className="text-xl font-semibold tracking-wide text-white/90">YSX Flow</span>
            </div>
          </div>

          <div className="max-w-lg">
            <h1 className="text-4xl lg:text-5xl font-semibold leading-tight mb-6 tracking-tight animate-slide-up" style={{ animationDelay: '0.2s' }}>
              Turn Follow-Ups Into <span className="text-volt-text inline-block hover:scale-105 transition-transform duration-300 origin-left">Opportunities</span>.
            </h1>
            <p className="text-lg text-neutral-300 leading-relaxed mb-8 animate-slide-up" style={{ animationDelay: '0.3s' }}>
              Connect your Email Provider to unlock intelligent, context-aware follow-up automation powered by Gemini AI.
            </p>

            <div className="flex flex-col gap-4 animate-slide-up" style={{ animationDelay: '0.4s' }}>
              <div className="flex items-center space-x-3 text-neutral-200 group cursor-default">
                <CheckCircle2 className="w-5 h-5 text-volt-text group-hover:scale-110 transition-transform" />
                <span className="group-hover:text-white transition-colors">Smart Reply Detection</span>
              </div>
              <div className="flex items-center space-x-3 text-neutral-200 group cursor-default">
                <CheckCircle2 className="w-5 h-5 text-volt-text group-hover:scale-110 transition-transform" />
                <span className="group-hover:text-white transition-colors">Automated Scheduling</span>
              </div>
              <div className="flex items-center space-x-3 text-neutral-200 group cursor-default">
                <CheckCircle2 className="w-5 h-5 text-volt-text group-hover:scale-110 transition-transform" />
                <span className="group-hover:text-white transition-colors">Gemini 2.5 Flash Integration</span>
              </div>
            </div>
          </div>
        </div>

        <div className="relative z-10 grid grid-cols-3 gap-4 mt-16 lg:mt-0 pt-8 border-t border-white/10 animate-slide-up" style={{ animationDelay: '0.5s' }}>
          <div className="group cursor-pointer">
            <div className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center mb-3 group-hover:bg-volt/20 transition-all duration-300 group-hover:scale-110">
              <Shield className="w-5 h-5 text-volt-text" />
            </div>
            <h3 className="font-semibold text-sm mb-1 group-hover:text-volt-text transition-colors">Secure</h3>
            <p className="text-[10px] text-neutral-400 uppercase tracking-wider">Encryption</p>
          </div>
          <div className="group cursor-pointer">
            <div className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center mb-3 group-hover:bg-amber-500/20 transition-all duration-300 group-hover:scale-110">
              <Zap className="w-5 h-5 text-amber-300" />
            </div>
            <h3 className="font-semibold text-sm mb-1 group-hover:text-amber-200 transition-colors">Fast</h3>
            <p className="text-[10px] text-neutral-400 uppercase tracking-wider">Real-time</p>
          </div>
          <div className="group cursor-pointer">
            <div className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center mb-3 group-hover:bg-emerald-500/20 transition-all duration-300 group-hover:scale-110">
              <BarChart className="w-5 h-5 text-emerald-300" />
            </div>
            <h3 className="font-semibold text-sm mb-1 group-hover:text-emerald-200 transition-colors">Proven</h3>
            <p className="text-[10px] text-neutral-400 uppercase tracking-wider">Analytics</p>
          </div>
        </div>
      </div>

      {/* Right Side - Login / Signup Form */}
      <div className="flex-1 shrink-0 flex items-center justify-center p-8 bg-transparent relative">
        <div className="max-w-md w-full space-y-8 animate-in slide-in-from-bottom-8 fade-in duration-700 fill-mode-forwards">
          <div className="text-center lg:text-left">
            <h2 className="text-3xl font-semibold text-white tracking-tight">
              {mode === 'LOGIN' ? 'Welcome Back' : 'Create Your Account'}
            </h2>
            <p className="mt-2 text-neutral-400">
              {mode === 'LOGIN' ? 'Sign in to manage your campaigns.' : 'Sign up to start automating your outreach.'}
            </p>
          </div>

          <Card padding="md" className="hover:shadow-[0_0_36px_rgb(2_1_255/0.25)] transition-shadow duration-300">
            <div className="flex space-x-1 p-1 bg-white/5 rounded-lg mb-6">
              {(['LOGIN', 'SIGNUP'] as Mode[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => { setMode(m); setError(null); }}
                  className={`flex-1 py-2 text-xs font-semibold rounded-md transition-all ${
                    mode === m ? 'bg-white/15 text-white' : 'text-neutral-400 hover:text-neutral-200'
                  }`}
                >
                  {m === 'LOGIN' ? 'Log In' : 'Sign Up'}
                </button>
              ))}
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-neutral-300 mb-1.5">Email</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-3 w-4 h-4 text-neutral-400" />
                  <input
                    type="email"
                    required
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@company.com"
                    className="w-full pl-9 pr-4 py-2.5 bg-white/[0.03] border border-white/10 rounded-xl text-sm text-neutral-100 placeholder-neutral-500 focus:outline-none focus:border-volt-text transition-colors duration-300"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-neutral-300 mb-1.5">Password</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-3 w-4 h-4 text-neutral-400" />
                  <input
                    type="password"
                    required
                    minLength={8}
                    autoComplete={mode === 'LOGIN' ? 'current-password' : 'new-password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="At least 8 characters"
                    className="w-full pl-9 pr-4 py-2.5 bg-white/[0.03] border border-white/10 rounded-xl text-sm text-neutral-100 placeholder-neutral-500 focus:outline-none focus:border-volt-text transition-colors duration-300"
                  />
                </div>
              </div>

              {error && (
                <div className="flex items-start space-x-2 p-3 bg-red-500/10 border border-red-400/20 rounded-lg text-red-300 text-xs">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

              <Button
                type="submit"
                disabled={isSubmitting}
                loading={isSubmitting}
                fullWidth
                className="py-3.5 group relative overflow-hidden hover:scale-[1.02] active:scale-[0.98]"
                rightIcon={
                  !isSubmitting ? (
                    <span className="bg-white/20 p-1 rounded text-white transition-transform group-hover:translate-x-1">
                      <ArrowRight className="w-4 h-4" />
                    </span>
                  ) : undefined
                }
              >
                {isSubmitting ? 'Please wait...' : mode === 'LOGIN' ? 'Log In' : 'Create Account'}
              </Button>
            </form>
          </Card>

          <div className="flex justify-center space-x-6 text-xs font-medium text-neutral-500 pt-8 border-t border-white/10">
            <a href="#" className="hover:text-neutral-300 transition-colors duration-300 hover:underline">Privacy Policy</a>
            <a href="#" className="hover:text-neutral-300 transition-colors duration-300 hover:underline">Terms of Service</a>
            <a href="#" className="hover:text-neutral-300 transition-colors duration-300 hover:underline">Help Center</a>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LoginScreen;
