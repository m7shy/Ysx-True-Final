
import React, { useState, useEffect } from 'react';
import { Check, Plus, Layers, ExternalLink, RefreshCw, Loader2, XCircle, FlaskConical, AlertTriangle, Wrench } from 'lucide-react';
import { AppError, AppErrorCode } from '../types';
import { ConfirmModal } from './ConfirmModal';
import { useSettings } from '../context/SettingsContext';

interface IntegrationItem {
  id: string;
  name: string;
  connected: boolean;
  desc: string;
  color: string;
  hasError?: boolean;
}

const INITIAL_INTEGRATIONS: IntegrationItem[] = [
  { id: 'zoho_mail', name: "Zoho Mail", connected: true, desc: "Sync sent items, drafts, and folders.", color: "bg-[#2C72B8]" },
  { id: 'google_workspace', name: "Google Workspace", connected: false, desc: "Sync Gmail sent items and drafts via OAuth2.", color: "bg-[#EA4335]" },
  { id: 'zoho_crm', name: "Zoho CRM", connected: false, desc: "Sync contacts, leads, and deals bi-directionally.", color: "bg-[#e32933]" },
  { id: 'hubspot', name: "HubSpot", connected: false, desc: "Import contacts and log email activity automatically.", color: "bg-[#ff7a59]" },
  { id: 'salesforce', name: "Salesforce", connected: false, desc: "Enterprise CRM sync for leads and opportunities.", color: "bg-[#00a1e0]" },
  { id: 'slack', name: "Slack", connected: false, desc: "Get instant notifications for replies and bounces.", color: "bg-[#4a154b]" },
  { id: 'calendly', name: "Calendly", connected: false, desc: "Include dynamic booking links in your signatures.", color: "bg-[#006bff]" },
];

interface IntegrationsViewProps {
  onViewDocumentation: () => void;
  isSandbox?: boolean;
  onFixConnection?: () => void;
  appError?: AppError | null;
}

export const IntegrationsView: React.FC<IntegrationsViewProps> = ({ onViewDocumentation, isSandbox = false, onFixConnection, appError }) => {
  const { settings } = useSettings();
  const [integrations, setIntegrations] = useState<IntegrationItem[]>(INITIAL_INTEGRATIONS);
  const [connectingId, setConnectingId] = useState<string | null>(null);
  
  // Modal State
  const [disconnectId, setDisconnectId] = useState<string | null>(null);

  // Sync connection status with Settings
  useEffect(() => {
    setIntegrations(prev => prev.map(item => {
      if (item.id === 'zoho_mail') {
        // Zoho is connected if we have a token OR we are in sandbox (simulated)
        const isConnected = !!settings.zohoAccessToken || (!settings.useRealApi);
        return { ...item, connected: isConnected };
      }
      if (item.id === 'google_workspace') {
        // Google is connected if we have a token
        const isConnected = !!settings.googleAccessToken;
        return { ...item, connected: isConnected };
      }
      return item;
    }));
  }, [settings.zohoAccessToken, settings.googleAccessToken, settings.useRealApi]);

  // Update integrations state based on structured AppError
  useEffect(() => {
    // Determine if we have an authentication error
    const isAuthError = appError && appError.code === AppErrorCode.AUTH_EXPIRED;
    
    // Determine which provider has the error (if known)
    const targetProvider = appError?.provider;

    setIntegrations(prev => prev.map(item => {
      if (isAuthError) {
        if (targetProvider === 'ZOHO' && item.id === 'zoho_mail') {
           return { ...item, hasError: true };
        }
        if (targetProvider === 'GOOGLE' && item.id === 'google_workspace') {
           return { ...item, hasError: true };
        }
        // Fallback
        if (!targetProvider && (item.id === 'zoho_mail' || item.id === 'google_workspace')) {
           return { ...item, hasError: true };
        }
      }
      return { ...item, hasError: false };
    }));
  }, [appError]);

  const handleConnect = (id: string) => {
    // For Zoho and Google, we redirect to settings/auth flow
    if (id === 'zoho_mail' || id === 'google_workspace') {
      if (onFixConnection) onFixConnection();
      return;
    }

    setConnectingId(id);
    // Simulate API connection delay for others
    setTimeout(() => {
      setIntegrations(prev => prev.map(item => 
        item.id === id ? { ...item, connected: true } : item
      ));
      setConnectingId(null);
    }, 2000);
  };

  const confirmDisconnect = () => {
    if (!disconnectId) return;
    setIntegrations(prev => prev.map(item => 
      item.id === disconnectId ? { ...item, connected: false } : item
    ));
    setDisconnectId(null);
  };

  return (
    <div className="p-8 animate-in fade-in slide-in-from-bottom-4 duration-500 h-full overflow-y-auto custom-scrollbar">
      <ConfirmModal 
        isOpen={!!disconnectId}
        onClose={() => setDisconnectId(null)}
        onConfirm={confirmDisconnect}
        title="Disconnect Integration?"
        message="Are you sure you want to disconnect this service? Syncing will stop immediately."
        confirmText="Disconnect"
        isDanger={true}
      />

      <div className="flex justify-between items-center mb-8">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center">
            <Layers className="w-6 h-6 mr-2 text-brand-500" />
            Integrations
          </h2>
          <p className="text-slate-500 dark:text-slate-400 mt-1">Connect your workflow tools to supercharge YSX Flow.</p>
        </div>
        <button 
          onClick={onViewDocumentation}
          className="text-sm text-brand-600 dark:text-brand-400 font-medium hover:underline flex items-center group"
        >
          View Documentation <ExternalLink className="w-3 h-3 ml-1 group-hover:translate-x-0.5 transition-transform" />
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4">
        {integrations.map((item) => (
          <div key={item.id} className={`flex flex-col md:flex-row md:items-center justify-between p-6 bg-white dark:bg-slate-900 border rounded-xl shadow-sm transition-all duration-300 ${item.hasError ? 'border-red-300 bg-red-50 dark:bg-red-900/10' : item.connected ? 'border-green-200 dark:border-green-900/30 bg-green-50/30 dark:bg-green-900/10' : 'border-slate-200 dark:border-slate-800 hover:shadow-md'}`}>
            <div className="flex items-center space-x-5 mb-4 md:mb-0">
              <div className={`w-14 h-14 rounded-xl flex items-center justify-center text-white shadow-lg ${item.color} shrink-0 relative overflow-hidden group`}>
                 {/* Shine effect */}
                 <div className="absolute inset-0 bg-gradient-to-tr from-transparent via-white/20 to-transparent -translate-x-[150%] group-hover:translate-x-[150%] transition-transform duration-1000" />
                 <span className="font-bold text-xl tracking-tighter relative z-10">{item.name.substring(0, 2).toUpperCase()}</span>
              </div>
              <div>
                  <h3 className="text-lg font-bold text-slate-900 dark:text-white flex items-center flex-wrap gap-2">
                    {item.name}
                    
                    {/* Status Badges */}
                    {item.hasError ? (
                       <span className="px-2 py-0.5 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 text-[10px] uppercase font-bold rounded-full animate-pulse flex items-center">
                          <AlertTriangle className="w-3 h-3 mr-1" /> Re-auth Required
                       </span>
                    ) : item.connected ? (
                        <span className="px-2 py-0.5 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 text-[10px] uppercase font-bold rounded-full animate-in zoom-in">Active</span>
                    ) : null}

                    {item.connected && isSandbox && (item.id === 'zoho_mail') && !item.hasError && (
                        <span className="px-2 py-0.5 bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 text-[10px] uppercase font-bold rounded-full animate-in zoom-in flex items-center border border-slate-200 dark:border-slate-700">
                            <FlaskConical className="w-3 h-3 mr-1" /> Simulated
                        </span>
                    )}
                  </h3>
                  <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5 max-w-md">{item.desc}</p>
              </div>
            </div>
            
            <div className="flex items-center space-x-3 pl-19 md:pl-0">
              {item.connected && (
                <>
                  <button 
                    className="p-2 text-slate-400 hover:text-red-500 transition-colors rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20" 
                    title="Disconnect"
                    onClick={() => setDisconnectId(item.id)}
                  >
                    <XCircle className="w-5 h-5" />
                  </button>
                  {!item.hasError && (
                    <button 
                      className="p-2 text-slate-400 hover:text-brand-600 transition-colors rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800" 
                      title="Sync Now"
                    >
                      <RefreshCw className="w-5 h-5" />
                    </button>
                  )}
                </>
              )}
              
              {item.hasError && onFixConnection ? (
                <button
                   onClick={onFixConnection}
                   className="px-5 py-2.5 rounded-lg text-sm font-bold bg-red-600 text-white hover:bg-red-700 shadow-lg shadow-red-500/20 transition-all flex items-center justify-center min-w-[140px]"
                >
                   <Wrench className="w-4 h-4 mr-2" /> Fix Connection
                </button>
              ) : (
                <button 
                  onClick={() => !item.connected && handleConnect(item.id)}
                  disabled={connectingId === item.id || (item.connected && (item.id === 'zoho_mail' || item.id === 'google_workspace'))} 
                  className={`px-5 py-2.5 rounded-lg text-sm font-bold transition-all active:scale-95 min-w-[140px] flex justify-center ${
                    item.connected 
                      ? 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 cursor-default' 
                      : 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white border border-slate-300 dark:border-slate-600 hover:border-brand-500 hover:text-brand-600 dark:hover:text-brand-400 shadow-sm hover:shadow'
                  } ${connectingId === item.id ? 'opacity-80 cursor-wait' : ''}`}
                >
                  {connectingId === item.id ? (
                    <span className="flex items-center animate-pulse"><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Connecting...</span>
                  ) : item.connected ? (
                    <span className="flex items-center"><Check className="w-4 h-4 mr-2" /> Connected</span>
                  ) : (
                    <span className="flex items-center"><Plus className="w-4 h-4 mr-2" /> Connect</span>
                  )}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
