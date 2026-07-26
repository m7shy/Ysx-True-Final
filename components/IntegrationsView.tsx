
import React, { useState, useEffect } from 'react';
import { Check, Plus, Layers, ExternalLink, RefreshCw, Loader2, XCircle, FlaskConical, AlertTriangle, Wrench, Mailbox as MailboxIcon } from 'lucide-react';
import { AppError, AppErrorCode } from '../types';
import { ConfirmModal } from './ConfirmModal';
import { useSettings } from '../context/SettingsContext';
import { apiGet, apiPost, ApiError } from '../services/apiClient';
import { useNotification } from '../context/NotificationContext';
import { Card, Button, Badge } from '../src/design/ui';

interface IntegrationItem {
  id: string;
  name: string;
  connected: boolean;
  desc: string;
  color: string;
  hasError?: boolean;
  comingSoon?: boolean;
}

// 'google_workspace' and 'microsoft_365' are backed by the real backend OAuth2
// consent flow (GET /api/auth/oauth/:provider/start); 'zoho_mail'/'zoho_crm' are
// legacy/simulated. hubspot/salesforce/slack/calendly have no backend support at
// all and are marked comingSoon so the UI doesn't offer a fake "Connect".
const INITIAL_INTEGRATIONS: IntegrationItem[] = [
  { id: 'zoho_mail', name: "Zoho Mail", connected: true, desc: "Sync sent items, drafts, and folders.", color: "bg-[#2C72B8]" },
  { id: 'google_workspace', name: "Google Workspace", connected: false, desc: "Sync Gmail sent items and drafts via OAuth2.", color: "bg-[#EA4335]" },
  { id: 'microsoft_365', name: "Microsoft 365", connected: false, desc: "Sync Outlook sent items and drafts via OAuth2.", color: "bg-[#00A4EF]" },
  { id: 'zoho_crm', name: "Zoho CRM", connected: false, desc: "Sync contacts, leads, and deals bi-directionally.", color: "bg-[#e32933]" },
  { id: 'hubspot', name: "HubSpot", connected: false, desc: "Import contacts and log email activity automatically.", color: "bg-[#ff7a59]", comingSoon: true },
  { id: 'salesforce', name: "Salesforce", connected: false, desc: "Enterprise CRM sync for leads and opportunities.", color: "bg-[#00a1e0]", comingSoon: true },
  { id: 'slack', name: "Slack", connected: false, desc: "Get instant notifications for replies and bounces.", color: "bg-[#4a154b]", comingSoon: true },
  { id: 'calendly', name: "Calendly", connected: false, desc: "Include dynamic booking links in your signatures.", color: "bg-[#006bff]", comingSoon: true },
];

const OAUTH_BACKED_IDS = new Set(['google_workspace', 'microsoft_365']);

function oauthProviderFor(id: string): 'gmail' | 'microsoft' | null {
  if (id === 'google_workspace') return 'gmail';
  if (id === 'microsoft_365') return 'microsoft';
  return null;
}

interface ConnectedMailbox {
  id: string;
  email: string;
  provider: 'GMAIL' | 'MICROSOFT';
  isActive: boolean;
  expiresAt: string | null;
}

interface IntegrationsViewProps {
  onViewDocumentation: () => void;
  isSandbox?: boolean;
  onFixConnection?: () => void;
  appError?: AppError | null;
}

export const IntegrationsView: React.FC<IntegrationsViewProps> = ({ onViewDocumentation, isSandbox = false, onFixConnection, appError }) => {
  const { settings } = useSettings();
  const { showToast } = useNotification();
  const [integrations, setIntegrations] = useState<IntegrationItem[]>(INITIAL_INTEGRATIONS);
  const [connectingId, setConnectingId] = useState<string | null>(null);
  const [mailboxes, setMailboxes] = useState<ConnectedMailbox[]>([]);
  const [isLoadingMailboxes, setIsLoadingMailboxes] = useState(true);

  // Modal State
  const [disconnectId, setDisconnectId] = useState<string | null>(null);

  const loadMailboxes = async () => {
    setIsLoadingMailboxes(true);
    try {
      const data = await apiGet<{ mailboxes: ConnectedMailbox[] }>('/api/mail/health');
      setMailboxes(data.mailboxes);
    } catch (err) {
      // Non-fatal: the integrations grid still renders without the mailbox list.
      console.error('Failed to load connected mailboxes', err);
    } finally {
      setIsLoadingMailboxes(false);
    }
  };

  useEffect(() => {
    loadMailboxes();
  }, []);

  // Google/Microsoft connection state is derived from real connected mailboxes.
  useEffect(() => {
    setIntegrations(prev => prev.map(item => {
      if (item.id === 'zoho_mail') {
        // Zoho used to read as "connected" whenever a browser-held OAuth token
        // existed. That token is gone with the 'oauth-api' transport, and the
        // backend mailbox store has no ZOHO provider, so in real-API mode Zoho
        // has no connection to report — only simulated mode shows it connected.
        return { ...item, connected: !settings.useRealApi };
      }
      if (item.id === 'google_workspace') {
        return { ...item, connected: mailboxes.some(m => m.provider === 'GMAIL' && m.isActive) };
      }
      if (item.id === 'microsoft_365') {
        return { ...item, connected: mailboxes.some(m => m.provider === 'MICROSOFT' && m.isActive) };
      }
      return item;
    }));
  }, [settings.useRealApi, mailboxes]);

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

  const handleConnect = async (id: string) => {
    // Zoho isn't backed by the new OAuth2 mailbox flow; keep the legacy redirect.
    if (id === 'zoho_mail') {
      if (onFixConnection) onFixConnection();
      return;
    }

    const provider = oauthProviderFor(id);
    if (provider) {
      setConnectingId(id);
      try {
        const data = await apiGet<{ authorizeUrl: string }>(`/api/auth/oauth/${provider}/start`);
        window.location.href = data.authorizeUrl;
      } catch (err) {
        const message = err instanceof ApiError ? err.message : 'Could not start the OAuth connect flow.';
        showToast('ERROR', message);
        setConnectingId(null);
      }
      return;
    }

    // comingSoon integrations (HubSpot/Salesforce/Slack/Calendly) have no
    // backend support at all — the Coming Soon badge replaces their Connect
    // button below, so this path shouldn't be reachable, but guard anyway.
    const item = integrations.find(i => i.id === id);
    if (item?.comingSoon) return;

    setConnectingId(id);
    // Zoho CRM: still a simulated connection (no real backend yet).
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
          <h2 className="text-2xl font-semibold text-white flex items-center">
            <Layers className="w-6 h-6 mr-2 text-volt-text" />
            Integrations
          </h2>
          <p className="text-neutral-400 mt-1">Connect your workflow tools to supercharge YSX Flow.</p>
        </div>
        <button
          onClick={onViewDocumentation}
          className="text-sm text-volt-text font-medium hover:underline flex items-center group rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt-text focus-visible:ring-offset-2 focus-visible:ring-offset-noir px-2 py-1"
        >
          View Documentation <ExternalLink className="w-3 h-3 ml-1 group-hover:translate-x-0.5 transition-transform" />
        </button>
      </div>

      <div className="mb-8">
        <div className="flex justify-between items-center mb-3">
          <h3 className="text-sm font-semibold text-neutral-300 flex items-center">
            <MailboxIcon className="w-4 h-4 mr-2 text-volt-text" />
            Connected Mailboxes
          </h3>
          <button
            onClick={loadMailboxes}
            className="p-1.5 text-neutral-400 hover:text-volt-text rounded-full hover:bg-white/[0.05] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt-text focus-visible:ring-offset-2 focus-visible:ring-offset-noir"
            aria-label="Refresh connected mailboxes"
            title="Refresh"
          >
            <RefreshCw className={`w-4 h-4 ${isLoadingMailboxes ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {isLoadingMailboxes ? (
          <div className="p-4 text-sm text-neutral-400">Loading mailboxes...</div>
        ) : mailboxes.length === 0 ? (
          <div className="p-4 text-sm text-neutral-400 bg-white/[0.02] border border-dashed border-white/10 rounded-2xl">
            No mailboxes connected yet. Connect Google Workspace or Microsoft 365 below to start rotating sends across them.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {mailboxes.map((mb) => (
              <Card key={mb.id} padding="none" className="flex items-center justify-between p-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-white truncate">{mb.email}</p>
                  <p className="text-xs text-neutral-400">{mb.provider === 'GMAIL' ? 'Google Workspace' : 'Microsoft 365'}</p>
                </div>
                <Badge variant={mb.isActive ? 'success' : 'neutral'} className="shrink-0">
                  {mb.isActive ? 'Active' : 'Paused'}
                </Badge>
              </Card>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4">
        {integrations.map((item) => (
          <div key={item.id} className={`flex flex-col md:flex-row md:items-center justify-between p-6 border rounded-2xl transition-all duration-300 ${item.hasError ? 'border-red-500/30 bg-red-500/[0.06]' : item.connected ? 'border-green-500/25 bg-green-500/[0.05]' : 'border-white/10 bg-white/[0.02] hover:bg-white/[0.04]'}`}>
            <div className="flex items-center space-x-5 mb-4 md:mb-0">
              <div className={`w-14 h-14 rounded-2xl flex items-center justify-center text-white ${item.color} shrink-0 relative overflow-hidden group`}>
                 {/* Shine effect */}
                 <div className="absolute inset-0 bg-gradient-to-tr from-transparent via-white/20 to-transparent -translate-x-[150%] group-hover:translate-x-[150%] transition-transform duration-1000" />
                 <span className="font-semibold text-xl tracking-tighter relative z-10">{item.name.substring(0, 2).toUpperCase()}</span>
              </div>
              <div>
                  <h3 className="text-lg font-semibold text-white flex items-center flex-wrap gap-2">
                    {item.name}

                    {/* Status Badges */}
                    {item.hasError ? (
                       <Badge variant="danger" className="animate-pulse" icon={<AlertTriangle className="w-3 h-3" />}>
                          Re-auth Required
                       </Badge>
                    ) : item.connected ? (
                        <Badge variant="success" className="animate-in zoom-in">Active</Badge>
                    ) : null}

                    {item.connected && isSandbox && (item.id === 'zoho_mail') && !item.hasError && (
                        <Badge variant="neutral" className="animate-in zoom-in" icon={<FlaskConical className="w-3 h-3" />}>
                            Simulated
                        </Badge>
                    )}

                    {item.comingSoon && (
                        <Badge variant="neutral">Coming Soon</Badge>
                    )}
                  </h3>
                  <p className="text-sm text-neutral-400 mt-0.5 max-w-md">{item.desc}</p>
              </div>
            </div>

            <div className="flex items-center space-x-3 pl-19 md:pl-0">
              {item.connected && (
                <>
                  <button
                    className="p-2 text-neutral-400 hover:text-red-500 transition-colors rounded-full hover:bg-red-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt-text focus-visible:ring-offset-2 focus-visible:ring-offset-noir"
                    aria-label={`Disconnect ${item.name}`}
                    title="Disconnect"
                    onClick={() => setDisconnectId(item.id)}
                  >
                    <XCircle className="w-5 h-5" />
                  </button>
                  {!item.hasError && (
                    <button
                      className="p-2 text-neutral-400 hover:text-volt-text transition-colors rounded-full hover:bg-white/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt-text focus-visible:ring-offset-2 focus-visible:ring-offset-noir"
                      aria-label={`Sync ${item.name} now`}
                      title="Sync Now"
                    >
                      <RefreshCw className="w-5 h-5" />
                    </button>
                  )}
                </>
              )}

              {item.hasError && onFixConnection ? (
                <Button
                   variant="danger"
                   onClick={onFixConnection}
                   leftIcon={<Wrench className="w-4 h-4" />}
                   className="min-w-[140px]"
                >
                   Fix Connection
                </Button>
              ) : item.comingSoon ? (
                <Button
                  variant="secondary"
                  disabled
                  className="min-w-[140px]"
                >
                  Coming Soon
                </Button>
              ) : (
                <Button
                  variant="secondary"
                  onClick={() => !item.connected && handleConnect(item.id)}
                  disabled={connectingId === item.id || (item.connected && (item.id === 'zoho_mail' || item.id === 'google_workspace'))}
                  loading={connectingId === item.id}
                  leftIcon={item.connected ? <Check className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                  className={`min-w-[140px] ${item.connected ? '' : 'hover:border-volt-text hover:text-volt-text'}`}
                >
                  {connectingId === item.id ? 'Connecting...' : item.connected ? 'Connected' : 'Connect'}
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
