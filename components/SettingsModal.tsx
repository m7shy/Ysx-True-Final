import React, { useState } from 'react';
import { X, Save, Globe, Shield, User, Sliders, AlertTriangle, PlugZap, CheckCircle2, Lock, Hammer, Square, ChevronDown, ChevronUp, Copy, ExternalLink, ArrowRight, Mail, Key, HelpCircle, Server } from 'lucide-react';
import { UserSettings, FollowUpTone } from '../types';
import { ConfirmModal } from './ConfirmModal';
import { persistPublicSettings } from '../context/SettingsContext';

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

    const settingsToSave = { ...settings, ...localSettings };
    // Persist PUBLIC settings only (clientId, provider, region) so they survive
    // the OAuth redirect. Secrets are never written to localStorage (C3).
    persistPublicSettings(settingsToSave);
    onSave(settingsToSave); 
    
    const redirectUri = window.location.origin;
    const scope = "ZohoMail.messages.READ,ZohoMail.messages.CREATE,ZohoMail.accounts.READ";
    const authUrl = getAuthUrl(localSettings.zohoRegion);
    
    const state = generateState('zoho');
    
    const url = `${authUrl}?scope=${scope}&client_id=${localSettings.zohoClientId}&response_type=token&redirect_uri=${redirectUri}&access_type=online&state=${encodeURIComponent(state)}`;
    
    window.location.href = url;
  };

  const handleGoogleConnect = () => {
    if (!localSettings.googleClientId) {
      setGoogleClientIdError(true);
      return;
    }
    setGoogleClientIdError(false);

    const settingsToSave = { ...settings, ...localSettings };
    // Persist PUBLIC settings only (clientId, provider, region) so they survive
    // the OAuth redirect. Secrets are never written to localStorage (C3).
    persistPublicSettings(settingsToSave);
    onSave(settingsToSave); 

    const redirectUri = window.location.origin;
    const scope = "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send";
    const authUrl = "https://accounts.google.com/o/oauth2/v2/auth";

    const state = generateState('google');

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
                   <div className="grid grid-cols-3 gap-2">
                      <button 
                        onClick={() => { setLocalSettings({...localSettings, activeProvider: 'ZOHO'}); setShowGuide(false); }}
                        className={`p-2 rounded-lg border text-sm font-medium flex flex-col items-center justify-center transition-all ${localSettings.activeProvider === 'ZOHO' ? 'bg-[#2C72B8]/10 border-[#2C72B8] text-[#2C72B8]' : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-500'}`}
                      >
                         <img src="https://upload.wikimedia.org/wikipedia/commons/b/b8/Zoho_Corporation_logo.png" alt="Zoho" className="h-6 mb-1 object-contain" />
                         <span className="text-xs">Zoho Mail</span>
                      </button>
                      <button 
                        onClick={() => { setLocalSettings({...localSettings, activeProvider: 'GMAIL'}); setShowGuide(false); }}
                        className={`p-2 rounded-lg border text-sm font-medium flex flex-col items-center justify-center transition-all ${localSettings.activeProvider === 'GMAIL' ? 'bg-red-50 dark:bg-red-900/20 border-red-500 text-red-600' : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-500'}`}
                      >
                         <Mail className="w-6 h-6 mb-1" />
                         <span className="text-xs">Google</span>
                      </button>
                      {/* NEW MICROSOFT BUTTON */}
                      <button 
                        onClick={() => { setLocalSettings({...localSettings, activeProvider: 'MICROSOFT'}); setShowGuide(false); }}
                        className={`p-2 rounded-lg border text-sm font-medium flex flex-col items-center justify-center transition-all ${localSettings.activeProvider === 'MICROSOFT' ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-500 text-blue-600' : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-500'}`}
                      >
                         <img src="https://upload.wikimedia.org/wikipedia/commons/thumb/d/df/Microsoft_Office_Outlook_%282018%E2%80%93present%29.svg/512px-Microsoft_Office_Outlook_%282018%E2%80%93present%29.svg.png" alt="Outlook" className="h-6 w-6 mb-1 object-contain" />
                         <span className="text-xs">Outlook</span>
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
                        </div>
                        <p className="text-xs text-slate-500 mt-3">
                           Secure Gateway (IMAP/SMTP) is the only supported transport mode. The legacy Browser API (OAuth) mode has been removed.
                        </p>
                     </div>

                     {(
                       <div className="p-6 border border-slate-300 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-900/50 flex flex-col items-center text-center">
                          <div className="w-12 h-12 bg-brand-100 dark:bg-brand-900/30 text-brand-600 dark:text-brand-400 rounded-full flex items-center justify-center mb-4">
                             <Server className="w-6 h-6" />
                          </div>
                          <h4 className="text-slate-900 dark:text-white font-bold mb-2">Server-Managed Credentials</h4>
                          <p className="text-sm text-slate-500 max-w-sm mb-4">
                             Your email credentials are securely stored in the backend server's <code>.env</code> file. No client-side configuration is needed here.
                          </p>
                          <div className="text-xs font-mono bg-slate-200 dark:bg-slate-800 px-3 py-2 rounded text-slate-600 dark:text-slate-400">
                             {localSettings.activeProvider === 'ZOHO' ? 'ZOHO_USER / ZOHO_APP_PASSWORD' : 
                              localSettings.activeProvider === 'MICROSOFT' ? 'MICROSOFT_USER / MICROSOFT_APP_PASSWORD' :
                              'GMAIL_USER / GMAIL_APP_PASSWORD'}
                          </div>
                          {localSettings.activeProvider === 'MICROSOFT' && (
                             <p className="text-[10px] text-slate-400 mt-2">
                                Note: For Outlook/Microsoft, use an App Password generated from your Microsoft Account Security page.
                             </p>
                          )}
                       </div>
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