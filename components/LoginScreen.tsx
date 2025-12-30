import React, { useState } from 'react';
import { Mail, RefreshCw, Shield, Zap, BarChart, CheckCircle2, ArrowRight, Lock, TestTube2, PlugZap, X } from 'lucide-react';

interface LoginScreenProps {
  onConnect: (mode: 'SANDBOX' | 'LIVE') => void;
  isConnecting: boolean;
}

const LoginScreen: React.FC<LoginScreenProps> = ({ onConnect, isConnecting }) => {
  const [showModeSelect, setShowModeSelect] = useState(false);

  const handleMainButtonClick = () => {
    setShowModeSelect(true);
  };

  const selectMode = (mode: 'SANDBOX' | 'LIVE') => {
    setShowModeSelect(false);
    onConnect(mode);
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col lg:flex-row font-sans overflow-hidden">
      
      {/* Mode Selection Modal */}
      {showModeSelect && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/80 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden relative animate-in zoom-in-95 duration-300">
             <button 
               onClick={() => setShowModeSelect(false)} 
               className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 p-1 hover:bg-slate-100 rounded-full transition-colors"
             >
                <X className="w-5 h-5" />
             </button>
             
             <div className="p-8 text-center">
                <h2 className="text-2xl font-bold text-slate-900 mb-2">Choose Connection Mode</h2>
                <p className="text-slate-500 mb-8">Select how you want to experience YSX Flow today.</p>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                   <button 
                     onClick={() => selectMode('SANDBOX')}
                     className="flex flex-col items-center p-6 border-2 border-slate-200 rounded-xl hover:border-brand-500 hover:bg-brand-50 transition-all group"
                   >
                      <div className="w-12 h-12 bg-green-100 text-green-600 rounded-full flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                         <TestTube2 className="w-6 h-6" />
                      </div>
                      <h3 className="font-bold text-slate-800 mb-1">Demo Sandbox</h3>
                      <p className="text-xs text-slate-500">Simulated data. No setup required. Perfect for testing UI.</p>
                   </button>

                   <button 
                     onClick={() => selectMode('LIVE')}
                     className="flex flex-col items-center p-6 border-2 border-slate-200 rounded-xl hover:border-purple-500 hover:bg-purple-50 transition-all group"
                   >
                      <div className="w-12 h-12 bg-purple-100 text-purple-600 rounded-full flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                         <PlugZap className="w-6 h-6" />
                      </div>
                      <h3 className="font-bold text-slate-800 mb-1">Live Connection</h3>
                      <p className="text-xs text-slate-500">Connect your real Email account via Secure Gateway.</p>
                   </button>
                </div>
             </div>
          </div>
        </div>
      )}

      {/* Left Side - Hero / Info */}
      <div className="flex-1 bg-gradient-to-br from-slate-900 via-brand-900 to-slate-900 p-8 lg:p-16 flex flex-col justify-between text-white relative overflow-hidden">
        {/* Decorative Elements */}
        <div className="absolute top-0 left-0 w-64 h-64 bg-brand-500/10 rounded-full -translate-x-1/2 -translate-y-1/2 blur-3xl animate-float" />
        <div className="absolute bottom-0 right-0 w-96 h-96 bg-brand-400/10 rounded-full translate-x-1/3 translate-y-1/3 blur-3xl animate-float-delayed" />
        <div className="absolute top-1/2 left-1/2 w-full h-full bg-brand-600/5 rounded-full -translate-x-1/2 -translate-y-1/2 blur-3xl animate-pulse-slow pointer-events-none" />

        <div className="relative z-10">
          <div className="flex items-center justify-between mb-12 animate-slide-up" style={{animationDelay: '0.1s'}}>
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 bg-white/10 backdrop-blur-md rounded-xl flex items-center justify-center border border-white/20 shadow-lg shadow-brand-900/20">
                <Mail className="w-6 h-6 text-white" />
              </div>
              <span className="text-xl font-bold tracking-wide text-white/90">YSX Flow</span>
            </div>
            
            <div className="flex items-center space-x-2 bg-brand-500/20 backdrop-blur-md border border-brand-400/30 rounded-full px-3 py-1">
               <TestTube2 className="w-4 h-4 text-brand-300" />
               <span className="text-xs font-medium text-brand-100 uppercase tracking-wider">Demo Mode</span>
            </div>
          </div>
          
          <div className="max-w-lg">
            <h1 className="text-4xl lg:text-5xl font-bold leading-tight mb-6 tracking-tight animate-slide-up" style={{animationDelay: '0.2s'}}>
              Turn Follow-Ups Into <span className="text-brand-400 inline-block hover:scale-105 transition-transform duration-300 origin-left">Opportunities</span>.
            </h1>
            <p className="text-lg text-slate-300 leading-relaxed mb-8 animate-slide-up" style={{animationDelay: '0.3s'}}>
              Connect your Email Provider to unlock intelligent, context-aware follow-up automation powered by Gemini AI.
            </p>
            
            <div className="flex flex-col gap-4 animate-slide-up" style={{animationDelay: '0.4s'}}>
                <div className="flex items-center space-x-3 text-slate-200 group cursor-default">
                    <CheckCircle2 className="w-5 h-5 text-brand-400 group-hover:scale-110 transition-transform" />
                    <span className="group-hover:text-white transition-colors">Smart Reply Detection</span>
                </div>
                <div className="flex items-center space-x-3 text-slate-200 group cursor-default">
                    <CheckCircle2 className="w-5 h-5 text-brand-400 group-hover:scale-110 transition-transform" />
                    <span className="group-hover:text-white transition-colors">Automated Scheduling</span>
                </div>
                <div className="flex items-center space-x-3 text-slate-200 group cursor-default">
                    <CheckCircle2 className="w-5 h-5 text-brand-400 group-hover:scale-110 transition-transform" />
                    <span className="group-hover:text-white transition-colors">Gemini 2.5 Flash Integration</span>
                </div>
            </div>
          </div>
        </div>

        <div className="relative z-10 grid grid-cols-3 gap-4 mt-16 lg:mt-0 pt-8 border-t border-white/10 animate-slide-up" style={{animationDelay: '0.5s'}}>
          <div className="group cursor-pointer">
            <div className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center mb-3 group-hover:bg-brand-500/20 transition-all duration-300 group-hover:scale-110">
                <Shield className="w-5 h-5 text-brand-300" />
            </div>
            <h3 className="font-semibold text-sm mb-1 group-hover:text-brand-200 transition-colors">Secure</h3>
            <p className="text-[10px] text-slate-400 uppercase tracking-wider">Encryption</p>
          </div>
          <div className="group cursor-pointer">
            <div className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center mb-3 group-hover:bg-amber-500/20 transition-all duration-300 group-hover:scale-110">
                <Zap className="w-5 h-5 text-amber-300" />
            </div>
            <h3 className="font-semibold text-sm mb-1 group-hover:text-amber-200 transition-colors">Fast</h3>
            <p className="text-[10px] text-slate-400 uppercase tracking-wider">Real-time</p>
          </div>
          <div className="group cursor-pointer">
            <div className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center mb-3 group-hover:bg-emerald-500/20 transition-all duration-300 group-hover:scale-110">
                <BarChart className="w-5 h-5 text-emerald-300" />
            </div>
            <h3 className="font-semibold text-sm mb-1 group-hover:text-emerald-200 transition-colors">Proven</h3>
            <p className="text-[10px] text-slate-400 uppercase tracking-wider">Analytics</p>
          </div>
        </div>
      </div>

      {/* Right Side - Login Form */}
      <div className="flex-1 flex items-center justify-center p-8 bg-white relative">
        <div className="max-w-md w-full space-y-8 animate-in slide-in-from-bottom-8 fade-in duration-700 fill-mode-forwards">
          <div className="text-center lg:text-left">
            <h2 className="text-3xl font-bold text-slate-900 tracking-tight">Welcome Back</h2>
            <p className="mt-2 text-slate-500">Connect your workspace to manage your campaigns.</p>
          </div>

          <div className="bg-slate-50 p-1 rounded-2xl border border-slate-100 shadow-sm p-6 hover:shadow-md transition-shadow duration-300">
             {/* UPDATED: Generic Branding */}
             <div className="flex items-center justify-between mb-8 bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                <div className="flex items-center space-x-4">
                   <div className="w-12 h-12 bg-slate-100 rounded-lg flex items-center justify-center transform transition-transform hover:rotate-3">
                      <Mail className="w-6 h-6 text-slate-600" />
                   </div>
                   <div>
                      <p className="font-bold text-slate-900 text-sm">Email Workspace</p>
                      <p className="text-xs text-slate-500 flex items-center mt-0.5">
                        <Lock className="w-3 h-3 mr-1" /> Google / Outlook / Zoho
                      </p>
                   </div>
                </div>
                <div className="flex items-center">
                    <div className="h-2.5 w-2.5 rounded-full bg-slate-300 relative">
                        {isConnecting && <div className="absolute inset-0 bg-brand-400 rounded-full animate-ping opacity-75"></div>}
                        {isConnecting && <div className="absolute inset-0 bg-brand-400 rounded-full"></div>}
                    </div>
                </div>
             </div>
             
             <div className="space-y-4">
                 <button 
                    onClick={handleMainButtonClick}
                    disabled={isConnecting}
                    className="w-full py-4 bg-brand-600 hover:bg-brand-700 text-white rounded-xl font-semibold shadow-lg shadow-brand-900/10 transition-all flex items-center justify-center disabled:opacity-70 disabled:cursor-not-allowed group relative overflow-hidden hover:scale-[1.02] active:scale-[0.98]"
                  >
                    <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-1000" />
                    
                    {isConnecting ? (
                      <RefreshCw className="w-5 h-5 animate-spin mr-2" />
                    ) : (
                      <span className="mr-2 bg-white/20 p-1 rounded text-white transition-transform group-hover:translate-x-1">
                        <ArrowRight className="w-4 h-4" />
                      </span>
                    )}
                    {isConnecting ? 'Connecting...' : 'Connect Workspace'}
                  </button>
                  
                  <p className="text-center text-xs text-slate-400 leading-relaxed">
                    Select "Sandbox Mode" to test features instantly without connecting a real account.
                  </p>
             </div>
          </div>
          
          <div className="flex justify-center space-x-6 text-xs font-medium text-slate-400 pt-8 border-t border-slate-100">
            <a href="#" className="hover:text-slate-600 transition-colors hover:underline">Privacy Policy</a>
            <a href="#" className="hover:text-slate-600 transition-colors hover:underline">Terms of Service</a>
            <a href="#" className="hover:text-slate-600 transition-colors hover:underline">Help Center</a>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LoginScreen;