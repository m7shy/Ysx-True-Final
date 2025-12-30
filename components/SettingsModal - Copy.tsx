import React, { useState } from 'react';
import { X, Save, Globe, Shield, User, Sliders, AlertTriangle, PlugZap, CheckCircle2, Lock, Hammer, Square, ChevronDown, ChevronUp, Copy, ExternalLink, ArrowRight, Mail, Key, HelpCircle, Server } from 'lucide-react';
import { UserSettings, FollowUpTone } from '../types';
import { ConfirmModal } from './ConfirmModal';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: UserSettings;
  onSave: (newSettings: UserSettings) => void;
}

const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose, settings, onSave }) => {
  const [activeTab, setActiveTab] = useState<'INTEGRATION' | 'AI' | 'SYNC' | 'DEPLOYMENT'>('INTEGRATION');
  const [localSettings, setLocalSettings] = useState<UserSettings>(settings);
  const [isSaving, setIsSaving] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  
  // New UI States
  const [showManualInput, setShowManualInput] = useState(false);
  const [clientIdError, setClientIdError] = useState(false);
  const [googleClientIdError, setGoogleClientIdError] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [showGuide, setShowGuide] = useState(false);

  if (!isOpen) return null;

  const handleSaveClick = () => {
    setShowConfirm(true);
  };

  const confirmSave = () => {
    setShowConfirm(false);
    setIsSaving(true);
    // Simulate save delay
    setTimeout(() => {
      onSave(localSettings);
      setIsSaving(false);
      onClose();
    }, 800);
  };

  const handleFactoryReset = () => {
    // Scoped clearing: Only remove keys belonging to this app
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && (key.startsWith('ysxflow_') || key.startsWith('zoho_mock_'))) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach(key => localStorage.removeItem(key));
    window.location.reload();
  };

  const getAuthUrl = (region: string) => {
    let baseUrl = 'https://accounts.zoho.com';
    switch (region) {
      case 'EU': baseUrl = 'https://accounts.zoho.eu'; break;
      case 'IN': baseUrl = 'https://accounts.zoho.in'; break;
      case 'AU': baseUrl = 'https://accounts.zoho.com.au'; break;
      case 'CN': baseUrl = 'https://accounts.zoho.com.cn'; break;
      default: baseUrl = 'https://accounts.zoho.com'; break;
    }
    return `${baseUrl}/oauth/v2/auth`;
  }

  const generateState = (provider: string) => {
    const nonce = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2);
    const state = `provider=${provider}&nonce=${nonce}`;
    sessionStorage.setItem('oauth_state', state);
    return state;
  };

  const handleZohoConnect = () => {
    if (!localSettings.zohoClientId) {
      setClientIdError(true);
      return;
    }
    setClientIdError(false);

    // FIX: Force save to localStorage immediately so data survives the redirect
    // We merge existing settings with local changes to ensure we don't lose anything
    const settingsToSave = { ...settings, ...localSettings };
    localStorage.setItem('ysxflow_settings', JSON.stringify(settingsToSave));
    onSave(settingsToSave); // Update parent state as well
    
    const redirectUri = window.location.origin;
    const scope = "ZohoMail.messages.READ,ZohoMail.messages.CREATE,ZohoMail.accounts.READ";
    const authUrl = getAuthUrl(localSettings.zohoRegion);
    
    // Generate secure state for CSRF protection
    const state = generateState('zoho');
    
    // Implicit Grant Flow
    const url = `${authUrl}?scope=${scope}&client_id=${localSettings.zohoClientId}&response_type=token&redirect_uri=${redirectUri}&access_type=online&state=${encodeURIComponent(state)}`;
    
    window.location.href = url;
  };

  const handleGoogleConnect = () => {
    if (!localSettings.googleClientId) {
      setGoogleClientIdError(true);
      return;
    }
    setGoogleClientIdError(false);

    // FIX: Force save to localStorage immediately so data survives the redirect
    // We merge existing settings with local changes to ensure we don't lose anything
    const settingsToSave = { ...settings, ...localSettings };
    localStorage.setItem('ysxflow_settings', JSON.stringify(settingsToSave));
    onSave(settingsToSave); // Update parent state as well

    const redirectUri = window.location.origin;
    const scope = "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send";
    const authUrl = "https://accounts.google.com/o/oauth2/v2/auth";

    // Generate secure state for CSRF protection
    const state = generateState('google');

    // Authorization Code Flow (to get refresh token)
    // access_type=offline is required for refresh token
    // prompt=consent forces consent screen to ensure refresh token is returned
    const url = `${authUrl}?scope=${scope}&client_id=${localSettings.googleClientId}&response_type=code&redirect_uri=${redirectUri}&access_type=offline&prompt=consent&state=${encodeURIComponent(state)}`;

    window.location.href = url;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl w-full max-w-2xl flex flex-col max-h-[90vh] animate-in zoom-in-95 slide-in-from-bottom-4 duration-300 border border-slate-200 dark:border-slate-800 overflow-hidden relative">
        
        {/* Reset Confirmation Modal */}
        <ConfirmModal 
          isOpen={showResetConfirm}
          onClose={() => setShowResetConfirm(false)}
          onConfirm={handleFactoryReset}
          title="Factory Reset?"
          message="Are you sure? This will wipe all local data (keys starting with 'ysxflow_' and 'zoho_mock_') and reset the app to its default state. This action cannot be undone."
          confirmText="Reset Everything"
          isDanger={true}
        />

        {/* Save Confirmation Overlay */}
        {showConfirm && (
          <div className="absolute inset-0 z-50 bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm flex items-center justify-center p-6 animate-in fade-in duration-200">
            <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-700 p-6 max-w-sm w-full transform scale-100 animate-in zoom-in-95 duration-200">
              <div className="flex flex-col items-center text-center">
                <div className="w-12 h-12 bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 rounded-full flex items-center justify-center mb-4">
                  <AlertTriangle className="w-6 h-6" />
                </div>
                <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-2">Save Changes?</h3>
                <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">
                  Are you sure you want to update your configuration settings? This may affect how your data interacts with your provider.
                </p>
                <div className="flex w-full gap-3">
                  <button
                    onClick={() => setShowConfirm(false)}
                    className="flex-1 px-4 py-2 bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-lg font-medium hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={confirmSave}
                    className="flex-1 px-4 py-2 bg-brand-600 text-white rounded-lg font-medium hover:bg-brand-700 transition-colors shadow-lg shadow-brand-500/20"
                  >
                    Confirm
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-slate-50 dark:bg-slate-950">
          <div>
            <h2 className="text-lg font-semibold text-slate-800 dark:text-white">Settings</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">Configure your email provider and AI preferences</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-transform hover:rotate-90">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* Sidebar Tabs */}
          <div className="w-48 bg-slate-50 dark:bg-slate-900/50 border-r border-slate-200 dark:border-slate-800 p-4 space-y-1">
            <button
              onClick={() => setActiveTab('INTEGRATION')}
              className={`w-full flex items-center px-3 py-2.5 text-sm font-medium rounded-lg transition-colors ${activeTab === 'INTEGRATION' ? 'bg-white dark:bg-slate-800 text-brand-600 dark:text-brand-400 shadow-sm' : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'}`}
            >
              <Globe className="w-4 h-4 mr-2" />
              Integration
            </button>
            <button
              onClick={() => setActiveTab('AI')}
              className={`w-full flex items-center px-3 py-2.5 text-sm font-medium rounded-lg transition-colors ${activeTab === 'AI' ? 'bg-white dark:bg-slate-800 text-brand-600 dark:text-brand-400 shadow-sm' : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'}`}
            >
              <User className="w-4 h-4 mr-2" />
              AI Persona
            </button>
            <button
              onClick={() => setActiveTab('SYNC')}
              className={`w-full flex items-center px-3 py-2.5 text-sm font-medium rounded-lg transition-colors ${activeTab === 'SYNC' ? 'bg-white dark:bg-slate-800 text-brand-600 dark:text-brand-400 shadow-sm' : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'}`}
            >
              <Sliders className="w-4 h-4 mr-2" />
              Sync & Data
            </button>
            <button
              onClick={() => setActiveTab('DEPLOYMENT')}
              className={`w-full flex items-center px-3 py-2.5 text-sm font-medium rounded-lg transition-colors ${activeTab === 'DEPLOYMENT' ? 'bg-white dark:bg-slate-800 text-brand-600 dark:text-brand-400 shadow-sm' : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'}`}
            >
              <Hammer className="w-4 h-4 mr-2" />
              Deployment
            </button>
          </div>

          {/* Content Area */}
          <div className="flex-1 p-6 overflow-y-auto bg-white dark:bg-slate-950 custom-scrollbar">
            
            {/* INTEGRATION TAB */}
            {activeTab === 'INTEGRATION' && (
              <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
                
                {/* Active Provider Selection */}
                <div className="bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
                   <h3 className="text-sm font-bold text-slate-900 dark:text-white mb-3">Active Email Provider</h3>
                   <div className="grid grid-cols-2 gap-3">
                      <button 
                        onClick={() => { setLocalSettings({...localSettings, activeProvider: 'ZOHO'}); setShowGuide(false); }}
                        className={`p-3 rounded-lg border text-sm font-medium flex items-center justify-center transition-all ${localSettings.activeProvider === 'ZOHO' ? 'bg-[#2C72B8]/10 border-[#2C72B8] text-[#2C72B8]' : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-500'}`}
                      >
                         <img src="https://upload.wikimedia.org/wikipedia/commons/b/b8/Zoho_Corporation_logo.png" alt="Zoho" className="w-12 mr-2 object-contain" />
                         Zoho Mail
                      </button>
                      <button 
                        onClick={() => { setLocalSettings({...localSettings, activeProvider: 'GMAIL'}); setShowGuide(false); }}
                        className={`p-3 rounded-lg border text-sm font-medium flex items-center justify-center transition-all ${localSettings.activeProvider === 'GMAIL' ? 'bg-red-50 dark:bg-red-900/20 border-red-500 text-red-600' : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-500'}`}
                      >
                         <Mail className="w-4 h-4 mr-2" />
                         Google Workspace
                      </button>
                   </div>
                </div>

                {/* Mode Selection Cards */}
                <div className="grid grid-cols-2 gap-4">
                  {/* Sandbox Card */}
                  <div 
                    onClick={() => setLocalSettings({...localSettings, useRealApi: false})}
                    className={`relative p-4 rounded-xl border-2 cursor-pointer transition-all ${!localSettings.useRealApi ? 'border-green-500 bg-green-50 dark:bg-green-900/20' : 'border-slate-200 dark:border-slate-700 hover:border-slate-300'}`}
                  >
                    {!localSettings.useRealApi && <div className="absolute top-2 right-2 text-green-600"><CheckCircle2 className="w-5 h-5" /></div>}
                    <div className="flex items-center mb-2 text-green-700 dark:text-green-400">
                       <Shield className="w-5 h-5 mr-2" />
                       <span className="font-bold text-sm">Sandbox Environment</span>
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Simulates data locally. No API credentials required. Perfect for UI testing.
                    </p>
                  </div>

                  {/* Live Card */}
                  <div 
                    onClick={() => setLocalSettings({...localSettings, useRealApi: true})}
                    className={`relative p-4 rounded-xl border-2 cursor-pointer transition-all ${localSettings.useRealApi ? 'border-purple-500 bg-purple-50 dark:bg-purple-900/20' : 'border-slate-200 dark:border-slate-700 hover:border-slate-300'}`}
                  >
                    {localSettings.useRealApi && <div className="absolute top-2 right-2 text-purple-600"><CheckCircle2 className="w-5 h-5" /></div>}
                    <div className="flex items-center mb-2 text-purple-700 dark:text-purple-400">
                       <PlugZap className="w-5 h-5 mr-2" />
                       <span className="font-bold text-sm">Live API Mode</span>
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Connects to real provider API. Requires valid configuration below.
                    </p>
                  </div>
                </div>

                {localSettings.useRealApi ? (
                  <div className="animate-in slide-in-from-top-2 fade-in space-y-6 pt-2">
                     
                     {/* TRANSPORT MODE TOGGLE */}
                     <div className="bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
                        <h4 className="text-xs font-bold text-slate-500 uppercase mb-3">Transport Protocol</h4>
                        <div className="space-y-3">
                           <label className="flex items-center p-3 border rounded-lg cursor-pointer bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 hover:border-brand-300">
                              <input 
                                type="radio" 
                                name="transportMode" 
                                value="gateway-imap-smtp"
                                checked={localSettings.transportMode === 'gateway-imap-smtp' || !localSettings.transportMode} // Default
                                onChange={() => setLocalSettings({...localSettings, transportMode: 'gateway-imap-smtp'})}
                                className="w-4 h-4 text-brand-600 focus:ring-brand-500 border-gray-300"
                              />
                              <div className="ml-3">
                                 <span className="block text-sm font-medium text-slate-900 dark:text-white flex items-center">
                                    <Server className="w-4 h-4 mr-2 text-brand-500" />
                                    Secure Gateway (IMAP/SMTP)
                                 </span>
                                 <span className="block text-xs text-slate-500">
                                    Uses backend server environment variables for credentials. Most secure.
                                 </span>
                              </div>
                           </label>

                           <label className="flex items-center p-3 border rounded-lg cursor-pointer bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 hover:border-brand-300">
                              <input 
                                type="radio" 
                                name="transportMode" 
                                value="oauth-api"
                                checked={localSettings.transportMode === 'oauth-api'}
                                onChange={() => setLocalSettings({...localSettings, transportMode: 'oauth-api'})}
                                className="w-4 h-4 text-brand-600 focus:ring-brand-500 border-gray-300"
                              />
                              <div className="ml-3">
                                 <span className="block text-sm font-medium text-slate-900 dark:text-white flex items-center">
                                    <Globe className="w-4 h-4 mr-2 text-purple-500" />
                                    Browser API (OAuth)
                                 </span>
                                 <span className="block text-xs text-slate-500">
                                    Legacy mode. Connects directly from browser using provider APIs.
                                 </span>
                              </div>
                           </label>
                        </div>
                     </div>

                     {localSettings.transportMode === 'gateway-imap-smtp' ? (
                       <div className="p-6 border border-slate-300 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-900/50 flex flex-col items-center text-center">
                          <div className="w-12 h-12 bg-brand-100 dark:bg-brand-900/30 text-brand-600 dark:text-brand-400 rounded-full flex items-center justify-center mb-4">
                             <Server className="w-6 h-6" />
                          </div>
                          <h4 className="text-slate-900 dark:text-white font-bold mb-2">Server-Managed Credentials</h4>
                          <p className="text-sm text-slate-500 max-w-sm mb-4">
                             Your email credentials are securely stored in the backend server's <code>.env</code> file. No client-side configuration is needed here.
                          </p>
                          <div className="text-xs font-mono bg-slate-200 dark:bg-slate-800 px-3 py-2 rounded text-slate-600 dark:text-slate-400">
                             {localSettings.activeProvider === 'ZOHO' ? 'ZOHO_USER / ZOHO_APP_PASSWORD' : 'GMAIL_USER / GMAIL_APP_PASSWORD'}
                          </div>
                       </div>
                     ) : (
                       /* LEGACY OAUTH CONFIGURATION */
                       localSettings.activeProvider === 'ZOHO' ? (
                         <div className="flex flex-col space-y-4 p-6 border border-dashed border-slate-300 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-900/50">
                            {/* ... Existing Zoho OAuth UI ... */}
                            <div className="flex items-center justify-between">
                              <h4 className="font-bold text-slate-700 dark:text-slate-300">Zoho Mail Configuration</h4>
                              <button onClick={() => setShowGuide(!showGuide)} className="text-xs text-brand-600 dark:text-brand-400 flex items-center hover:underline">
                                <HelpCircle className="w-3 h-3 mr-1" /> {showGuide ? 'Hide Guide' : 'Setup Guide'}
                              </button>
                            </div>

                            {showGuide && (
                              <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-lg text-xs text-blue-800 dark:text-blue-300 border border-blue-100 dark:border-blue-800 space-y-2 animate-in slide-in-from-top-2">
                                <p className="font-semibold flex items-center"><ExternalLink className="w-3 h-3 mr-1"/> 1. Go to <a href="https://api-console.zoho.com/" target="_blank" rel="noreferrer" className="underline ml-1 hover:text-blue-600">Zoho API Console</a></p>
                                <p>2. Click <strong>Add Client</strong> and choose <strong>Server-based Applications</strong>.</p>
                                <p>3. Set <strong>Homepage URL</strong> to: <code className="bg-white dark:bg-slate-950 px-1.5 py-0.5 rounded border border-blue-200 dark:border-blue-900 select-all">{window.location.origin}</code></p>
                                <p>4. Set <strong>Authorized Redirect URI</strong> to: <code className="bg-white dark:bg-slate-950 px-1.5 py-0.5 rounded border border-blue-200 dark:border-blue-900 select-all">{window.location.origin}</code></p>
                                <p>5. Copy the <strong>Client ID</strong> and <strong>Client Secret</strong> below.</p>
                              </div>
                            )}

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                   <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase mb-1">Region</label>
                                   <select
                                      value={localSettings.zohoRegion}
                                      onChange={(e) => setLocalSettings({...localSettings, zohoRegion: e.target.value as any})}
                                      className="w-full p-2.5 text-sm border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:ring-2 focus:ring-brand-500 outline-none"
                                    >
                                      <option value="US">United States (.com)</option>
                                      <option value="EU">Europe (.eu)</option>
                                      <option value="IN">India (.in)</option>
                                      <option value="CN">China (.com.cn)</option>
                                      <option value="AU">Australia (.com.au)</option>
                                    </select>
                                 </div>
                                 <div>
                                   <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase mb-1">
                                     Client ID
                                     {clientIdError && <span className="text-red-500 ml-1 text-[10px] normal-case">* Required</span>}
                                   </label>
                                   <input 
                                      type="text"
                                      value={localSettings.zohoClientId}
                                      onChange={(e) => {
                                        setLocalSettings({...localSettings, zohoClientId: e.target.value});
                                        if(e.target.value) setClientIdError(false);
                                      }}
                                      placeholder="1000.XXXXXXXXXXXXXXXX"
                                      className={`w-full p-2.5 text-sm border rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:ring-2 focus:ring-brand-500 outline-none font-mono ${clientIdError ? 'border-red-400' : 'border-slate-300 dark:border-slate-700'}`}
                                   />
                                 </div>
                            </div>

                            {/* New Secret & Refresh Token Fields for Permanent Access */}
                            <div className="grid grid-cols-1 gap-4">
                               <div>
                                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase mb-1">Client Secret</label>
                                  <input 
                                     type="password"
                                     value={localSettings.zohoClientSecret}
                                     onChange={(e) => setLocalSettings({...localSettings, zohoClientSecret: e.target.value})}
                                     placeholder="Your Client Secret"
                                     className="w-full p-2.5 text-sm border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 outline-none focus:ring-2 focus:ring-brand-500 font-mono"
                                  />
                               </div>
                               <div>
                                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase mb-1">
                                     Refresh Token (Permanent)
                                  </label>
                                  <input 
                                     type="password"
                                     value={localSettings.zohoRefreshToken}
                                     onChange={(e) => setLocalSettings({...localSettings, zohoRefreshToken: e.target.value})}
                                     placeholder="1000.xxxx.xxxx (Paste Permanent Token Here)"
                                     className="w-full p-2.5 text-sm border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 outline-none focus:ring-2 focus:ring-brand-500 font-mono"
                                  />
                                  <p className="text-[10px] text-slate-500 mt-1">
                                     Use this if you generated a Self-Client "Refresh Token". It does not expire.
                                  </p>
                               </div>
                            </div>

                            <div className="flex items-center my-2">
                               <div className="flex-1 h-px bg-slate-200 dark:bg-slate-700"></div>
                               <span className="px-3 text-xs text-slate-400 font-medium">OR TEMPORARY ACCESS</span>
                               <div className="flex-1 h-px bg-slate-200 dark:bg-slate-700"></div>
                            </div>

                            <div>
                               <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase mb-1">Access Token (Expires 1h)</label>
                               <input
                                 type="password"
                                 value={localSettings.zohoAccessToken}
                                 onChange={(e) => setLocalSettings({...localSettings, zohoAccessToken: e.target.value})}
                                 className="w-full p-3 text-sm border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 outline-none focus:ring-2 focus:ring-brand-500 font-mono"
                                 placeholder="1000.xxxx.xxxx"
                               />
                            </div>

                            <button 
                              onClick={handleZohoConnect}
                              className="w-full px-6 py-3 bg-[#2C72B8] hover:bg-[#235d96] text-white font-bold rounded-lg shadow-lg shadow-blue-900/20 transition-all active:scale-95 flex items-center justify-center mt-2"
                            >
                              <PlugZap className="w-5 h-5 mr-2" />
                              Connect via Zoho OAuth
                            </button>
                         </div>
                       ) : (
                         <div className="flex flex-col space-y-4 p-6 border border-dashed border-slate-300 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-900/50">
                            {/* ... Existing Google OAuth UI ... */}
                            <div className="flex items-center justify-between">
                              <h4 className="font-bold text-slate-700 dark:text-slate-300">Google Workspace Configuration</h4>
                              <button onClick={() => setShowGuide(!showGuide)} className="text-xs text-brand-600 dark:text-brand-400 flex items-center hover:underline">
                                <HelpCircle className="w-3 h-3 mr-1" /> {showGuide ? 'Hide Guide' : 'Setup Guide'}
                              </button>
                            </div>

                            {showGuide && (
                              <div className="bg-red-50 dark:bg-red-900/10 p-4 rounded-lg text-xs text-red-800 dark:text-red-300 border border-red-100 dark:border-red-900/30 space-y-2 animate-in slide-in-from-top-2">
                                <p className="font-semibold flex items-center"><ExternalLink className="w-3 h-3 mr-1"/> 1. Go to <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noreferrer" className="underline ml-1 hover:text-red-600">Google Cloud Console</a></p>
                                <p>2. Enable the <strong>Gmail API</strong> in the Library.</p>
                                <p>3. Configure OAuth Consent Screen (Add 'Test Users' if External).</p>
                                <p>4. Create Credentials {'>'} <strong>OAuth Client ID</strong> {'>'} <strong>Web Application</strong>.</p>
                                <p>5. Add to <strong>Authorized JavaScript origins</strong>: <code className="bg-white dark:bg-slate-950 px-1.5 py-0.5 rounded border border-red-200 dark:border-red-900/50 select-all">{window.location.origin}</code></p>
                                <p>6. Add to <strong>Authorized redirect URIs</strong>: <code className="bg-white dark:bg-slate-950 px-1.5 py-0.5 rounded border border-red-200 dark:border-red-900/50 select-all">{window.location.origin}</code></p>
                                <p>7. Copy the <strong>Client ID</strong> and <strong>Client Secret</strong> below.</p>
                              </div>
                            )}

                            <div>
                               <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase mb-1">
                                 Google Client ID
                                 {googleClientIdError && <span className="text-red-500 ml-1 text-[10px] normal-case">* Required</span>}
                               </label>
                               <input 
                                  type="text"
                                  value={localSettings.googleClientId}
                                  onChange={(e) => {
                                    setLocalSettings({...localSettings, googleClientId: e.target.value});
                                    if(e.target.value) setGoogleClientIdError(false);
                                  }}
                                  placeholder="xxxxxxxxxxxx-xxxxxxxxxxxxxxxxxxxxxxxx.apps.googleusercontent.com"
                                  className={`w-full p-2.5 text-sm border rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:ring-2 focus:ring-red-500 outline-none font-mono ${googleClientIdError ? 'border-red-400' : 'border-slate-300 dark:border-slate-700'}`}
                               />
                            </div>
                            <div>
                               <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase mb-1">Google Client Secret</label>
                               <input 
                                  type="password"
                                  value={localSettings.googleClientSecret}
                                  onChange={(e) => setLocalSettings({...localSettings, googleClientSecret: e.target.value})}
                                  placeholder="Your Google Client Secret"
                                  className="w-full p-2.5 text-sm border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 outline-none focus:ring-2 focus:ring-red-500 font-mono"
                               />
                               <p className="text-[10px] text-slate-500 mt-1">Required to exchange code for Refresh Token.</p>
                            </div>
                            <div>
                               <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase mb-1">
                                  Refresh Token
                               </label>
                               <input 
                                  type="password"
                                  value={localSettings.googleRefreshToken}
                                  onChange={(e) => setLocalSettings({...localSettings, googleRefreshToken: e.target.value})}
                                  placeholder="1//0xxxxxx (Paste Refresh Token Here)"
                                  className="w-full p-2.5 text-sm border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 outline-none focus:ring-2 focus:ring-red-500 font-mono"
                               />
                            </div>
                            <div>
                               <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase mb-1">Access Token</label>
                               <input
                                 type="password"
                                 value={localSettings.googleAccessToken}
                                 onChange={(e) => setLocalSettings({...localSettings, googleAccessToken: e.target.value})}
                                 className="w-full p-3 text-sm border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 outline-none focus:ring-2 focus:ring-red-500 font-mono"
                                 placeholder="ya29...."
                               />
                            </div>

                            <button 
                              onClick={handleGoogleConnect}
                              className="w-full px-6 py-3 bg-[#EA4335] hover:bg-[#d62d1f] text-white font-bold rounded-lg shadow-lg shadow-red-900/20 transition-all active:scale-95 flex items-center justify-center"
                            >
                              <PlugZap className="w-5 h-5 mr-2" />
                              Connect via Google OAuth
                            </button>
                         </div>
                       )
                     )}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-6 px-4 text-center bg-slate-50 dark:bg-slate-900/50 rounded-xl border border-dashed border-slate-300 dark:border-slate-700">
                     <CheckCircle2 className="w-12 h-12 text-slate-300 dark:text-slate-600 mb-3" />
                     <p className="text-sm text-slate-500 dark:text-slate-400">
                       Sandbox Mode Active. No configuration needed.
                     </p>
                  </div>
                )}
              </div>
            )}

            {/* AI PERSONA TAB */}
            {activeTab === 'AI' && (
              <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
                <div>
                  <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 uppercase mb-1">Default Tone</label>
                  <div className="grid grid-cols-2 gap-3">
                    {Object.values(FollowUpTone).map((tone) => (
                      <button
                        key={tone}
                        onClick={() => setLocalSettings({...localSettings, defaultTone: tone})}
                        className={`p-3 text-sm font-medium rounded-lg border text-left transition-all ${
                          localSettings.defaultTone === tone 
                            ? 'border-brand-500 bg-brand-50 dark:bg-brand-900/20 text-brand-700 dark:text-brand-400 ring-1 ring-brand-500' 
                            : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700'
                        }`}
                      >
                        {tone}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 uppercase mb-1">Email Signature</label>
                  <textarea
                    value={localSettings.emailSignature}
                    onChange={(e) => setLocalSettings({...localSettings, emailSignature: e.target.value})}
                    className="w-full p-3 text-sm border border-slate-300 dark:border-slate-700 rounded-lg bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-white focus:ring-2 focus:ring-brand-500 outline-none resize-y min-h-[100px]"
                    placeholder="e.g.&#10;John Doe&#10;Sales Director&#10;Acme Inc."
                  />
                  <p className="text-xs text-slate-400 mt-1">The AI will use this signature to sign off drafts.</p>
                </div>
              </div>
            )}

             {/* SYNC TAB */}
             {activeTab === 'SYNC' && (
              <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
                <div className="flex items-center justify-between p-4 border border-slate-200 dark:border-slate-700 rounded-lg">
                  <div>
                    <h4 className="text-sm font-medium text-slate-900 dark:text-white">Auto-Sync Background</h4>
                    <p className="text-xs text-slate-500 dark:text-slate-400">Check for new sent emails every 15 mins.</p>
                  </div>
                  <div 
                    onClick={() => setLocalSettings({...localSettings, autoSync: !localSettings.autoSync})}
                    className={`w-11 h-6 flex items-center rounded-full p-1 cursor-pointer transition-colors ${localSettings.autoSync ? 'bg-brand-600' : 'bg-slate-300 dark:bg-slate-600'}`}
                  >
                    <div className={`bg-white w-4 h-4 rounded-full shadow-md transform transition-transform ${localSettings.autoSync ? 'translate-x-5' : 'translate-x-0'}`} />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 uppercase mb-1">Sync Lookback Period</label>
                  <select
                    value={localSettings.syncLookbackDays}
                    onChange={(e) => setLocalSettings({...localSettings, syncLookbackDays: parseInt(e.target.value)})}
                    className="w-full p-2.5 text-sm border border-slate-300 dark:border-slate-700 rounded-lg bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-white focus:ring-2 focus:ring-brand-500 outline-none"
                  >
                    <option value={7}>Last 7 Days</option>
                    <option value={14}>Last 14 Days</option>
                    <option value={30}>Last 30 Days</option>
                    <option value={90}>Last 90 Days</option>
                  </select>
                  <p className="text-xs text-slate-400 mt-1">Emails older than this will not be imported.</p>
                </div>

                <div className="pt-6 border-t border-slate-200 dark:border-slate-700 mt-6">
                  <h4 className="text-sm font-bold text-red-600 dark:text-red-400 mb-2 flex items-center">
                    <AlertTriangle className="w-4 h-4 mr-2" /> Danger Zone
                  </h4>
                  <button 
                    onClick={() => setShowResetConfirm(true)}
                    className="px-4 py-2 border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-900/10 text-red-600 dark:text-red-400 text-sm font-medium rounded-lg hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors"
                  >
                    Factory Reset / Clear Demo Data
                  </button>
                </div>
              </div>
            )}

            {/* DEPLOYMENT TAB */}
            {activeTab === 'DEPLOYMENT' && (
              <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
                <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-100 dark:border-amber-800 rounded-lg p-4 mb-6">
                   <h3 className="font-bold text-amber-800 dark:text-amber-300 flex items-center mb-2">
                      <Hammer className="w-4 h-4 mr-2" />
                      Production Readiness Checklist
                   </h3>
                   <p className="text-sm text-amber-700 dark:text-amber-400 leading-relaxed">
                      The current application is running in a client-side simulation/demo environment. To deploy this for real-world production use with secure integration, the following architectural changes are required.
                   </p>
                </div>

                <div className="space-y-3">
                   {[
                     { title: "Replace Mock Service", desc: "Swap mockZoho.ts with real zohoApi.ts using fetch()." },
                     { title: "Authentication Backend", desc: "Set up a secure server (Node/Express) to handle the OAuth 2.0 Token Exchange (cannot do this securely in browser only)." },
                     { title: "Token Storage", desc: "Implement secure storage for Access/Refresh tokens (e.g., encrypted database)." },
                     { title: "Rate Limiting", desc: "Handle Zoho/Google API rate limits." }
                   ].map((item, i) => (
                      <div key={i} className="flex items-start p-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg">
                         <div className="mr-3 mt-0.5 text-slate-400">
                            <Square className="w-5 h-5" />
                         </div>
                         <div>
                            <h4 className="text-sm font-bold text-slate-900 dark:text-white">{item.title}</h4>
                            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{item.desc}</p>
                         </div>
                      </div>
                   ))}
                </div>
              </div>
            )}

          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 flex justify-end space-x-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSaveClick}
            disabled={isSaving}
            className="flex items-center px-6 py-2 bg-brand-600 hover:bg-brand-700 text-white rounded-lg shadow-md transition-all disabled:opacity-70 active:scale-95"
          >
            {isSaving ? (
              'Saving...'
            ) : (
              <>
                <Save className="w-4 h-4 mr-2" />
                Save Changes
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default SettingsModal;