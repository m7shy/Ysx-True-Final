import React, { useState } from 'react';
import { X, Save, Globe, Shield, User, Sliders, AlertTriangle, PlugZap, CheckCircle2, Hammer, Square, Mail, Server } from 'lucide-react';
import { UserSettings, FollowUpTone } from '../types';
import { ConfirmModal } from './ConfirmModal';
import { Button, Select, Textarea } from '../src/design/ui';

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

  // The browser-side OAuth connect flows (Zoho + Google) were removed along
  // with the 'oauth-api' transport: they redirected to the provider with a
  // client id held in localStorage and exchanged the code through endpoints
  // that were never mounted server-side. Mailboxes are now connected via the
  // backend OAuth flow (server/src/auth/oauthRoutes.ts), reached from the
  // Integrations view.

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-[#0a0a0a]/95 backdrop-blur-xl rounded-2xl w-full max-w-2xl flex flex-col max-h-[90vh] animate-in zoom-in-95 slide-in-from-bottom-4 duration-300 border border-white/10 overflow-hidden relative">

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
          <div className="absolute inset-0 z-50 bg-noir/80 backdrop-blur-sm flex items-center justify-center p-6 animate-in fade-in duration-200">
            <div className="bg-[#0a0a0a] rounded-2xl border border-white/10 p-6 max-w-sm w-full transform scale-100 animate-in zoom-in-95 duration-200">
              <div className="flex flex-col items-center text-center">
                <div className="w-12 h-12 bg-amber-500/10 text-amber-400 rounded-full flex items-center justify-center mb-4">
                  <AlertTriangle className="w-6 h-6" />
                </div>
                <h3 className="text-lg font-semibold text-white mb-2">Save Changes?</h3>
                <p className="text-sm text-neutral-400 mb-6">
                  Are you sure you want to update your configuration settings? This may affect how your data interacts with your provider.
                </p>
                <div className="flex w-full gap-3">
                  <Button variant="secondary" fullWidth onClick={() => setShowConfirm(false)}>
                    Cancel
                  </Button>
                  <Button fullWidth onClick={confirmSave}>
                    Confirm
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Header */}
        <div className="px-6 py-4 border-b border-white/10 flex justify-between items-center bg-white/[0.02]">
          <div>
            <h2 className="text-lg font-semibold text-white">Settings</h2>
            <p className="text-xs text-neutral-400">Configure your email provider and AI preferences</p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close settings"
            className="text-neutral-400 hover:text-neutral-200 transition-transform hover:rotate-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt-text rounded-full"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* Sidebar Tabs */}
          <div className="w-48 bg-white/[0.02] border-r border-white/10 p-4 space-y-1">
            <button
              onClick={() => setActiveTab('INTEGRATION')}
              aria-current={activeTab === 'INTEGRATION' ? 'page' : undefined}
              className={`w-full flex items-center px-3 py-2.5 text-sm font-medium rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt-text ${activeTab === 'INTEGRATION' ? 'bg-white/[0.08] text-volt-text' : 'text-neutral-400 hover:bg-white/[0.05]'}`}
            >
              <Globe className="w-4 h-4 mr-2" />
              Integration
            </button>
            <button
              onClick={() => setActiveTab('AI')}
              aria-current={activeTab === 'AI' ? 'page' : undefined}
              className={`w-full flex items-center px-3 py-2.5 text-sm font-medium rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt-text ${activeTab === 'AI' ? 'bg-white/[0.08] text-volt-text' : 'text-neutral-400 hover:bg-white/[0.05]'}`}
            >
              <User className="w-4 h-4 mr-2" />
              AI Persona
            </button>
            <button
              onClick={() => setActiveTab('SYNC')}
              aria-current={activeTab === 'SYNC' ? 'page' : undefined}
              className={`w-full flex items-center px-3 py-2.5 text-sm font-medium rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt-text ${activeTab === 'SYNC' ? 'bg-white/[0.08] text-volt-text' : 'text-neutral-400 hover:bg-white/[0.05]'}`}
            >
              <Sliders className="w-4 h-4 mr-2" />
              Sync & Data
            </button>
            <button
              onClick={() => setActiveTab('DEPLOYMENT')}
              aria-current={activeTab === 'DEPLOYMENT' ? 'page' : undefined}
              className={`w-full flex items-center px-3 py-2.5 text-sm font-medium rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt-text ${activeTab === 'DEPLOYMENT' ? 'bg-white/[0.08] text-volt-text' : 'text-neutral-400 hover:bg-white/[0.05]'}`}
            >
              <Hammer className="w-4 h-4 mr-2" />
              Deployment
            </button>
          </div>

          {/* Content Area */}
          <div className="flex-1 p-6 overflow-y-auto bg-noir custom-scrollbar">

            {/* INTEGRATION TAB */}
            {activeTab === 'INTEGRATION' && (
              <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">

                {/* Active Provider Selection */}
                <div className="bg-white/[0.02] border border-white/10 rounded-2xl p-4">
                   <h3 className="text-sm font-semibold text-white mb-3">Active Email Provider</h3>
                   <div className="grid grid-cols-3 gap-2">
                      <button
                        onClick={() => { setLocalSettings({...localSettings, activeProvider: 'ZOHO'}); setShowGuide(false); }}
                        aria-pressed={localSettings.activeProvider === 'ZOHO'}
                        className={`p-2 rounded-xl border text-sm font-medium flex flex-col items-center justify-center transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt-text ${localSettings.activeProvider === 'ZOHO' ? 'bg-[#2C72B8]/10 border-[#2C72B8] text-[#2C72B8]' : 'bg-white/[0.02] border-white/10 text-neutral-500'}`}
                      >
                         <img src="https://upload.wikimedia.org/wikipedia/commons/b/b8/Zoho_Corporation_logo.png" alt="Zoho" className="h-6 mb-1 object-contain" />
                         <span className="text-xs">Zoho Mail</span>
                      </button>
                      <button
                        onClick={() => { setLocalSettings({...localSettings, activeProvider: 'GMAIL'}); setShowGuide(false); }}
                        aria-pressed={localSettings.activeProvider === 'GMAIL'}
                        className={`p-2 rounded-xl border text-sm font-medium flex flex-col items-center justify-center transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt-text ${localSettings.activeProvider === 'GMAIL' ? 'bg-red-500/10 border-red-500 text-red-400' : 'bg-white/[0.02] border-white/10 text-neutral-500'}`}
                      >
                         <Mail className="w-6 h-6 mb-1" />
                         <span className="text-xs">Google</span>
                      </button>
                      {/* NEW MICROSOFT BUTTON */}
                      <button
                        onClick={() => { setLocalSettings({...localSettings, activeProvider: 'MICROSOFT'}); setShowGuide(false); }}
                        aria-pressed={localSettings.activeProvider === 'MICROSOFT'}
                        className={`p-2 rounded-xl border text-sm font-medium flex flex-col items-center justify-center transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt-text ${localSettings.activeProvider === 'MICROSOFT' ? 'bg-blue-500/10 border-blue-500 text-blue-400' : 'bg-white/[0.02] border-white/10 text-neutral-500'}`}
                      >
                         <img src="https://upload.wikimedia.org/wikipedia/commons/thumb/d/df/Microsoft_Office_Outlook_%282018%E2%80%93present%29.svg/512px-Microsoft_Office_Outlook_%282018%E2%80%93present%29.svg.png" alt="Outlook" className="h-6 w-6 mb-1 object-contain" />
                         <span className="text-xs">Outlook</span>
                      </button>
                   </div>
                </div>

                {/* Mode Selection Cards */}
                <div className="grid grid-cols-2 gap-4">
                  {/* Sandbox Card */}
                  <button
                    type="button"
                    onClick={() => setLocalSettings({...localSettings, useRealApi: false})}
                    aria-pressed={!localSettings.useRealApi}
                    className={`relative p-4 rounded-2xl border-2 cursor-pointer transition-all text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt-text ${!localSettings.useRealApi ? 'border-green-500 bg-green-500/10' : 'border-white/10 hover:border-white/20'}`}
                  >
                    {!localSettings.useRealApi && <div className="absolute top-2 right-2 text-green-400"><CheckCircle2 className="w-5 h-5" /></div>}
                    <div className="flex items-center mb-2 text-green-400">
                       <Shield className="w-5 h-5 mr-2" />
                       <span className="font-semibold text-sm">Sandbox Environment</span>
                    </div>
                    <p className="text-xs text-neutral-400">
                      Simulates data locally. No API credentials required. Perfect for UI testing.
                    </p>
                  </button>

                  {/* Live Card */}
                  <button
                    type="button"
                    onClick={() => setLocalSettings({...localSettings, useRealApi: true})}
                    aria-pressed={localSettings.useRealApi}
                    className={`relative p-4 rounded-2xl border-2 cursor-pointer transition-all text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt-text ${localSettings.useRealApi ? 'border-purple-500 bg-purple-500/10' : 'border-white/10 hover:border-white/20'}`}
                  >
                    {localSettings.useRealApi && <div className="absolute top-2 right-2 text-purple-400"><CheckCircle2 className="w-5 h-5" /></div>}
                    <div className="flex items-center mb-2 text-purple-400">
                       <PlugZap className="w-5 h-5 mr-2" />
                       <span className="font-semibold text-sm">Live API Mode</span>
                    </div>
                    <p className="text-xs text-neutral-400">
                      Connects to real provider API. Requires valid configuration below.
                    </p>
                  </button>
                </div>

                {localSettings.useRealApi ? (
                  <div className="animate-in slide-in-from-top-2 fade-in space-y-6 pt-2">

                     {/* TRANSPORT PROTOCOL — informational only.
                         This used to be a radio pair (gateway vs. "Browser API
                         (OAuth)"). The browser-OAuth mode was removed: the
                         endpoints it called were never mounted server-side, so
                         it had never actually worked, and it was the only
                         reason the tenant's OAuth client secret was kept in
                         localStorage. The gateway is now the only transport,
                         so there is nothing left to choose. */}
                     <div className="bg-white/[0.02] border border-white/10 rounded-2xl p-4">
                        <h4 className="text-xs font-semibold text-neutral-500 uppercase mb-3">Transport Protocol</h4>
                        <div className="flex items-center p-3 border rounded-xl bg-white/[0.02] border-white/10">
                           <Server className="w-4 h-4 mr-3 text-volt-text shrink-0" />
                           <div>
                              <span className="block text-sm font-medium text-white">Secure Gateway (IMAP/SMTP)</span>
                              <span className="block text-xs text-neutral-400">
                                 Mail is sent and read by the backend using server-side credentials. Your
                                 mailbox credentials never reach the browser.
                              </span>
                           </div>
                        </div>
                     </div>

                     {localSettings.transportMode === 'gateway-imap-smtp' ? (
                       <div className="p-6 border border-white/10 rounded-2xl bg-white/[0.02] flex flex-col items-center text-center">
                          <div className="w-12 h-12 bg-volt/10 text-volt-text rounded-full flex items-center justify-center mb-4">
                             <Server className="w-6 h-6" />
                          </div>
                          <h4 className="text-white font-semibold mb-2">Server-Managed Credentials</h4>
                          <p className="text-sm text-neutral-400 max-w-sm mb-4">
                             Your email credentials are securely stored in the backend server's <code>.env</code> file. No client-side configuration is needed here.
                          </p>
                          <div className="text-xs font-mono bg-white/[0.05] px-3 py-2 rounded text-neutral-400">
                             {localSettings.activeProvider === 'ZOHO' ? 'ZOHO_USER / ZOHO_APP_PASSWORD' :
                              localSettings.activeProvider === 'MICROSOFT' ? 'MICROSOFT_USER / MICROSOFT_APP_PASSWORD' :
                              'GMAIL_USER / GMAIL_APP_PASSWORD'}
                          </div>
                          {localSettings.activeProvider === 'MICROSOFT' && (
                             <p className="text-[10px] text-neutral-500 mt-2">
                                Note: For Outlook/Microsoft, use an App Password generated from your Microsoft Account Security page.
                             </p>
                          )}
                       </div>
                     ) : (
                       /* LEGACY OAUTH CONFIGURATION - Placeholder or existing */
                       <div className="flex flex-col items-center justify-center py-6 px-4 text-center bg-white/[0.02] rounded-2xl border border-dashed border-white/10">
                          <p className="text-sm text-neutral-400">
                            Please switch to <strong>Secure Gateway</strong> mode to use {localSettings.activeProvider} securely with App Passwords.
                          </p>
                       </div>
                     )}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-6 px-4 text-center bg-white/[0.02] rounded-2xl border border-dashed border-white/10">
                     <CheckCircle2 className="w-12 h-12 text-neutral-600 mb-3" />
                     <p className="text-sm text-neutral-400">
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
                  <label className="block text-xs font-medium text-neutral-500 uppercase mb-1">Default Tone</label>
                  <div className="grid grid-cols-2 gap-3">
                    {Object.values(FollowUpTone).map((tone) => (
                      <button
                        key={tone}
                        onClick={() => setLocalSettings({...localSettings, defaultTone: tone})}
                        aria-pressed={localSettings.defaultTone === tone}
                        className={`p-3 text-sm font-medium rounded-xl border text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt-text ${
                          localSettings.defaultTone === tone
                            ? 'border-volt-text bg-volt/10 text-volt-text ring-1 ring-volt-text'
                            : 'border-white/10 bg-white/[0.02] text-neutral-400 hover:bg-white/[0.05]'
                        }`}
                      >
                        {tone}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-neutral-500 uppercase mb-1">Email Signature</label>
                  <Textarea
                    value={localSettings.emailSignature}
                    onChange={(e) => setLocalSettings({...localSettings, emailSignature: e.target.value})}
                    className="resize-y min-h-[100px]"
                    placeholder="e.g.&#10;John Doe&#10;Sales Director&#10;Acme Inc."
                  />
                  <p className="text-xs text-neutral-500 mt-1">The AI will use this signature to sign off drafts.</p>
                </div>
              </div>
            )}

             {/* SYNC TAB */}
             {activeTab === 'SYNC' && (
              <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
                <div className="flex items-center justify-between p-4 border border-white/10 rounded-2xl">
                  <div>
                    <h4 className="text-sm font-medium text-white">Auto-Sync Background</h4>
                    <p className="text-xs text-neutral-400">Check for new sent emails every 15 mins.</p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={localSettings.autoSync}
                    aria-label="Toggle auto-sync background"
                    onClick={() => setLocalSettings({...localSettings, autoSync: !localSettings.autoSync})}
                    className={`w-11 h-6 flex items-center rounded-full p-1 cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt-text ${localSettings.autoSync ? 'bg-volt' : 'bg-white/10'}`}
                  >
                    <div className={`bg-white w-4 h-4 rounded-full shadow-md transform transition-transform ${localSettings.autoSync ? 'translate-x-5' : 'translate-x-0'}`} />
                  </button>
                </div>

                <div>
                  <label className="block text-xs font-medium text-neutral-500 uppercase mb-1">Sync Lookback Period</label>
                  <Select
                    value={localSettings.syncLookbackDays}
                    onChange={(e) => setLocalSettings({...localSettings, syncLookbackDays: parseInt(e.target.value)})}
                  >
                    <option value={7}>Last 7 Days</option>
                    <option value={14}>Last 14 Days</option>
                    <option value={30}>Last 30 Days</option>
                    <option value={90}>Last 90 Days</option>
                  </Select>
                  <p className="text-xs text-neutral-500 mt-1">Emails older than this will not be imported.</p>
                </div>

                <div className="pt-6 border-t border-white/10 mt-6">
                  <h4 className="text-sm font-semibold text-red-400 mb-2 flex items-center">
                    <AlertTriangle className="w-4 h-4 mr-2" /> Danger Zone
                  </h4>
                  <Button variant="danger" onClick={() => setShowResetConfirm(true)}>
                    Factory Reset / Clear Demo Data
                  </Button>
                </div>
              </div>
            )}

            {/* DEPLOYMENT TAB */}
            {activeTab === 'DEPLOYMENT' && (
              <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
                <div className="bg-amber-500/10 border border-amber-500/20 rounded-2xl p-4 mb-6">
                   <h3 className="font-semibold text-amber-300 flex items-center mb-2">
                      <Hammer className="w-4 h-4 mr-2" />
                      Production Readiness Checklist
                   </h3>
                   <p className="text-sm text-amber-400/90 leading-relaxed">
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
                      <div key={i} className="flex items-start p-3 bg-white/[0.02] border border-white/10 rounded-xl">
                         <div className="mr-3 mt-0.5 text-neutral-500">
                            <Square className="w-5 h-5" />
                         </div>
                         <div>
                            <h4 className="text-sm font-semibold text-white">{item.title}</h4>
                            <p className="text-xs text-neutral-400 mt-1">{item.desc}</p>
                         </div>
                      </div>
                   ))}
                </div>
              </div>
            )}

          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-white/10 bg-white/[0.02] flex justify-end space-x-3">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={handleSaveClick}
            disabled={isSaving}
            loading={isSaving}
            leftIcon={!isSaving ? <Save className="w-4 h-4" /> : undefined}
          >
            {isSaving ? 'Saving...' : 'Save Changes'}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default SettingsModal;
