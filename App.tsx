import React, { useState, useEffect } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useSettings } from './context/SettingsContext';
import { useNotification } from './context/NotificationContext';
import { useAuth } from './context/AuthContext';
import { CampaignProvider, useCampaigns } from './context/CampaignContext';
import { Lead } from './types';
import { ViewTransition } from './components/motion/primitives';

// Components
import LoginScreen from './components/LoginScreen';
import SettingsModal from './components/SettingsModal';
import { CampaignNameModal } from './src/features/campaigns/CampaignNameModal';
import { CampaignWizard } from './src/features/campaigns/CampaignWizard';

// Views
import { DashboardView } from './components/DashboardView';
import { TemplatesView } from './components/TemplatesView';
import { AnalyticsView } from './components/AnalyticsView';
import { IntegrationsView } from './components/IntegrationsView';
import { DocumentationView } from './components/DocumentationView';
import { LeadsView } from './components/LeadsView';
import { BrandOSView } from './components/BrandOSView';
import { StoryVaultView } from './components/StoryVaultView';
import { CampaignsListView } from './components/CampaignsListView';
import { CampaignDetailView } from './components/CampaignDetailView';
import { UniboxView } from './components/UniboxView';
import { ScraperView } from './components/ScraperView';

// Icons & UI
import { Mail, RefreshCcw, Layout, Plus, FileText, BarChart3, Settings, Layers, X, Users, Menu, PlugZap, Palette, Film, Megaphone, MessageSquare, AlertTriangle, LogOut, Radar, Briefcase } from 'lucide-react';
import ClientPortalView from './components/ClientPortalView';
import { gwHealth } from './services/mailGateway';
import { getScraperStatus, getAutoSchedule } from './services/scraperApi';

// 'PERFORMANCE' was removed from this union on 2026-07-29 rather than merely
// unlinked from the sidebar: components/PerformanceView.tsx is fed entirely by
// services/mockPerformance (invented client names, fees, hours logged and
// revenue) and there is no data model behind it to wire up. Leaving it in the
// union would let it be routed to again by a one-word change; removing it makes
// tsc refuse. The component and its fixture are kept on disk for whenever the
// profitability data model actually exists.
type View = 'DASHBOARD' | 'TEMPLATES' | 'ANALYTICS' | 'INTEGRATIONS' | 'DOCUMENTATION' | 'LEADS' | 'SCRAPER' | 'BRAND_OS' | 'STORY_VAULT' | 'CAMPAIGNS' | 'CAMPAIGN_DETAIL' | 'UNIBOX' | 'CLIENT_PORTAL';

// Campaign-creation overlay flow: name popup first, then the 4-step wizard.
type WizardFlow = 'closed' | 'naming' | 'wizard';

const VIEW_TITLES: Record<View, string> = {
  DASHBOARD: 'Dashboard',
  TEMPLATES: 'Templates',
  ANALYTICS: 'Analytics',
  INTEGRATIONS: 'Integrations',
  DOCUMENTATION: 'Docs',
  LEADS: 'Leads',
  SCRAPER: 'YouTube Scraper',
  BRAND_OS: 'Brand OS',
  STORY_VAULT: 'Story Vault',
  CAMPAIGNS: 'Campaigns',
  CAMPAIGN_DETAIL: 'Campaign Details',
  UNIBOX: 'Unified Inbox',
  CLIENT_PORTAL: 'Client Portal',
};

interface NavButtonProps {
  view: View;
  icon: any;
  label: string;
  isActive: boolean;
  onSelect: (view: View) => void;
  indicatorId: string;
  /** Shows a pulsing dot — a scrape (manual or auto) is running right now, even off-page. */
  busy?: boolean;
}

// Module-scope (not inline in AppContent) so the layoutId pill survives re-renders.
const NavButton: React.FC<NavButtonProps> = ({ view, icon: Icon, label, isActive, onSelect, indicatorId, busy }) => (
  <button
    onClick={() => onSelect(view)}
    aria-current={isActive ? 'page' : undefined}
    className={`relative w-full flex items-center px-3 py-3 md:py-2 text-sm font-medium rounded-full transition-colors duration-300 group
      ${isActive ? 'text-white' : 'text-neutral-400 hover:bg-white/[0.04] hover:text-white'}`}
  >
    {isActive && (
      <motion.div
        layoutId={indicatorId}
        transition={{ type: 'spring', bounce: 0.2, duration: 0.6 }}
        className="absolute inset-0 rounded-full bg-volt/10 border border-volt/40 shadow-volt-soft"
      />
    )}
    <Icon className={`relative z-10 w-5 h-5 md:w-4 md:h-4 mr-3 transition-colors duration-300 ${isActive ? 'text-volt-text' : 'text-neutral-500 group-hover:text-neutral-300'}`} />
    <span className="relative z-10">{label}</span>
    {busy && (
      <span className="relative z-10 ml-auto flex items-center gap-1 pr-1" title="A scrape is running">
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-400" />
        </span>
      </span>
    )}
  </button>
);

interface SidebarContentProps {
  currentView: View;
  onViewChange: (view: View) => void;
  onCompose: () => void;
  onOpenSettings: () => void;
  onCloseMobile: () => void;
  user: { email?: string } | null;
  logout: () => void;
  indicatorId: string;
  scraperBusy: boolean;
}

const SidebarContent: React.FC<SidebarContentProps> = ({
  currentView,
  onViewChange,
  onCompose,
  onOpenSettings,
  onCloseMobile,
  user,
  logout,
  indicatorId,
  scraperBusy,
}) => {
  const nav = (view: View, icon: any, label: string, isActive?: boolean, busy?: boolean) => (
    <NavButton view={view} icon={icon} label={label} isActive={isActive ?? currentView === view} onSelect={onViewChange} indicatorId={indicatorId} busy={busy} />
  );

  return (
    <>
      <div className="p-6 flex items-center justify-between space-x-3 text-white">
        <div className="flex items-center space-x-3">
          <div className="w-8 h-8 bg-volt rounded-2xl flex items-center justify-center shadow-volt-soft">
            <Layout className="w-5 h-5" />
          </div>
          <span className="font-semibold text-lg tracking-tight">YSX Flow</span>
        </div>
        <button onClick={onCloseMobile} aria-label="Close menu" className="md:hidden text-neutral-400 hover:text-white p-2 rounded-full transition-colors duration-300">
          <X className="w-6 h-6" />
        </button>
      </div>

      <div className="px-4 mb-6">
        <button
          onClick={onCompose}
          className="w-full flex items-center justify-center px-4 py-3 bg-volt text-white font-medium rounded-full transition-all duration-300 hover:shadow-volt active:scale-95"
        >
          <Plus className="w-5 h-5 mr-2" />
          Compose
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-3 space-y-6 custom-scrollbar">
        <div>
          <h3 className="px-3 text-[11px] font-semibold text-neutral-500 uppercase tracking-wider mb-2">Inbox</h3>
          <nav className="space-y-1">
            {nav('UNIBOX', MessageSquare, 'Unified Inbox')}
          </nav>
        </div>

        <div>
          <h3 className="px-3 text-[11px] font-semibold text-neutral-500 uppercase tracking-wider mb-2">Campaigns</h3>
          <nav className="space-y-1">
            {nav('DASHBOARD', Mail, 'Dashboard')}
            {nav('CAMPAIGNS', Megaphone, 'All Campaigns', currentView === 'CAMPAIGNS' || currentView === 'CAMPAIGN_DETAIL')}
          </nav>
        </div>

        <div>
          <h3 className="px-3 text-[11px] font-semibold text-neutral-500 uppercase tracking-wider mb-2">Workspace</h3>
          <nav className="space-y-1">
            {nav('LEADS', Users, 'Leads')}
            {nav('CLIENT_PORTAL', Briefcase, 'Client Portal')}
            {nav('SCRAPER', Radar, 'Scraper', undefined, scraperBusy)}
            {nav('STORY_VAULT', Film, 'Story Vault')}
            {nav('BRAND_OS', Palette, 'Brand OS')}
            {nav('TEMPLATES', FileText, 'Templates')}
            {nav('ANALYTICS', BarChart3, 'Analytics')}
            {nav('INTEGRATIONS', Layers, 'Integrations')}
          </nav>
        </div>

        <div>
          <h3 className="px-3 text-[11px] font-semibold text-neutral-500 uppercase tracking-wider mb-2">Settings</h3>
          <nav className="space-y-1">
            <button
              onClick={onOpenSettings}
              className="w-full flex items-center px-3 py-3 md:py-2 text-sm font-medium rounded-full text-neutral-400 hover:bg-white/[0.04] hover:text-white transition-colors duration-300 group"
            >
              <Settings className="w-5 h-5 md:w-4 md:h-4 mr-3 text-neutral-500 group-hover:text-neutral-300" />
              Configuration
            </button>
          </nav>
        </div>
      </div>

      <div className="p-4 border-t border-white/10 space-y-4 bg-white/[0.02] backdrop-blur-xl">
        <div className="flex items-center justify-between group pb-safe">
          <div className="flex items-center min-w-0">
            <div className="w-8 h-8 rounded-full bg-volt flex items-center justify-center text-white font-medium text-xs shadow-volt-soft shrink-0">
              {(user?.email ?? '?').charAt(0).toUpperCase()}
            </div>
            <div className="ml-3 min-w-0">
              <p className="text-sm font-medium text-white truncate">{user?.email}</p>
              <p className="text-xs text-neutral-500">Logged in</p>
            </div>
          </div>
          <button
            onClick={logout}
            title="Log out"
            aria-label="Log out"
            className="p-2 text-neutral-400 hover:text-white hover:bg-white/10 rounded-full transition-colors duration-300 shrink-0"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </>
  );
};

// --- Inner App Logic to use Campaign Context ---
const AppContent: React.FC = () => {
  const { settings: userSettings, updateSettings, saveSettings } = useSettings();
  const { showToast } = useNotification();
  const { campaigns } = useCampaigns();

  const { isLoggedIn, isHydrating, logout, user } = useAuth();
  const [showGatewayWarning, setShowGatewayWarning] = useState(false);

  // Navigation
  const [currentView, setCurrentView] = useState<View>('DASHBOARD');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null);

  // Modals
  const [wizardFlow, setWizardFlow] = useState<WizardFlow>('closed');
  const [wizardInitialName, setWizardInitialName] = useState<string | undefined>(undefined);
  const [wizardInitialLead, setWizardInitialLead] = useState<{email: string, name: string, company: string} | undefined>(undefined);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // Scraper live status, polled globally (not just while on the Scraper page)
  // so the user has some signal an auto-scrape is running or just finished
  // even if they never navigate there — previously the only feedback was the
  // "Last auto-run" line on the Scraper page itself, seen only if/when someone
  // happened to open it after the fact.
  const [scraperBusy, setScraperBusy] = useState(false);

  // Handle the backend's OAuth mailbox-connect redirect
  // (GET /api/auth/oauth/:provider/callback -> ?connected=<provider>&email=... or ?oauth_error=...).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connected = params.get('connected');
    const email = params.get('email');
    const oauthError = params.get('oauth_error');

    if (connected) {
      showToast('SUCCESS', `${connected === 'gmail' ? 'Google Workspace' : 'Microsoft 365'} connected: ${email ?? ''}`);
      window.history.replaceState(null, '', window.location.pathname);
    } else if (oauthError) {
      showToast('ERROR', `Mailbox connection failed: ${oauthError}`);
      window.history.replaceState(null, '', window.location.pathname);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const checkGatewayHealth = async () => {
      if (userSettings.transportMode !== 'gateway-imap-smtp') {
        setShowGatewayWarning(false);
        return;
      }

      const healthy = await gwHealth();
      if (!cancelled) {
        setShowGatewayWarning(!healthy);
      }
    };

    checkGatewayHealth();
    return () => {
      cancelled = true;
    };
  }, [userSettings.transportMode]);

  // Poll scraper status app-wide: lights the sidebar dot while a scrape (auto
  // or manual) is running, and toasts the moment an auto-run finishes even if
  // the user is elsewhere in the CRM — auto-scrape has no one watching it
  // start, so this is the only way they'd otherwise learn it ran at all.
  useEffect(() => {
    // AppContent doesn't unmount on logout (it just renders <LoginScreen/>
    // in place), so scraperBusy would otherwise sit stale in state and could
    // flash the previous tenant's status for a moment on the next login.
    if (!isLoggedIn) {
      setScraperBusy(false);
      return;
    }
    let cancelled = false;
    let lastSeenRunAt: string | null = null;
    let first = true;

    const tick = async () => {
      try {
        const status = await getScraperStatus();
        if (!cancelled) setScraperBusy(Boolean(status.activeJobId));
      } catch { /* non-fatal — sidebar dot just stays as last known */ }

      try {
        const schedule = await getAutoSchedule();
        if (cancelled) return;
        if (first) {
          // Baseline on load — don't toast for a run that finished before this tab opened.
          lastSeenRunAt = schedule.lastRunAt;
          first = false;
          return;
        }
        if (schedule.lastRunAt && schedule.lastRunAt !== lastSeenRunAt) {
          lastSeenRunAt = schedule.lastRunAt;
          if (schedule.lastRunSummary?.error) {
            showToast('ERROR', `Auto-scrape failed: ${schedule.lastRunSummary.error}`);
          } else {
            showToast('SUCCESS', `Auto-scrape finished — ${schedule.lastRunSummary?.created ?? 0} new lead(s) added.`);
          }
        }
      } catch { /* non-fatal */ }
    };

    tick();
    const h = setInterval(tick, 60_000);
    return () => { cancelled = true; clearInterval(h); };
  }, [isLoggedIn]);

  // The wizard submits through CampaignContext.addCampaign itself; App only
  // owns the open/close flow and lands the user on the campaigns list after.
  const closeWizard = () => {
    setWizardFlow('closed');
    setWizardInitialName(undefined);
    setWizardInitialLead(undefined);
    setCurrentView('CAMPAIGNS');
  };

  const handleComposeFromLead = (lead: Lead) => {
    setWizardInitialLead({
      email: lead.email,
      name: lead.name,
      company: lead.company
    });
    setWizardFlow('naming');
    if (window.innerWidth < 768) {
      setIsMobileMenuOpen(false);
    }
  };

  const handleSaveSettings = (newSettings: any) => {
    saveSettings(newSettings);
    showToast('SUCCESS', "Configuration saved.");
  };

  const handleViewChange = (view: View) => {
    setCurrentView(view);
    setIsMobileMenuOpen(false);
  };

  const openCompose = () => {
    setWizardInitialLead(undefined);
    setWizardFlow('naming');
    setIsMobileMenuOpen(false);
  };

  const openSettings = () => {
    setIsSettingsOpen(true);
    setIsMobileMenuOpen(false);
  };

  if (isHydrating) {
    return (
      <div className="min-h-screen bg-canvas flex items-center justify-center">
        <RefreshCcw className="w-6 h-6 text-slate-400 animate-spin" />
      </div>
    );
  }

  if (!isLoggedIn) {
    return <LoginScreen />;
  }

  const renderView = (view: View): React.ReactNode => {
    switch (view) {
      case 'DASHBOARD': return <DashboardView />;
      case 'TEMPLATES': return <TemplatesView />;
      case 'ANALYTICS': return <AnalyticsView />;
      case 'INTEGRATIONS': return <IntegrationsView onViewDocumentation={() => setCurrentView('DOCUMENTATION')} isSandbox={!userSettings.useRealApi} onFixConnection={() => setIsSettingsOpen(true)} />;
      case 'DOCUMENTATION': return <DocumentationView onBack={() => setCurrentView('INTEGRATIONS')} />;
      case 'LEADS': return <LeadsView onCompose={handleComposeFromLead} />;
      case 'BRAND_OS': return <BrandOSView />;
      case 'STORY_VAULT': return <StoryVaultView />;
      case 'UNIBOX': return <UniboxView />;
      case 'CLIENT_PORTAL': return <ClientPortalView />;
      case 'SCRAPER': return <ScraperView />;
      case 'CAMPAIGNS':
        return (
          <CampaignsListView
            onNewCampaign={() => {
              setWizardInitialLead(undefined);
              setWizardFlow('naming');
            }}
            onSelectCampaign={(id) => {
              setSelectedCampaignId(id);
              setCurrentView('CAMPAIGN_DETAIL');
            }}
          />
        );
      case 'CAMPAIGN_DETAIL': {
        const campaign = campaigns.find(c => c.id === selectedCampaignId);
        if (!campaign) return null;
        return <CampaignDetailView campaign={campaign} onBack={() => setCurrentView('CAMPAIGNS')} />;
      }
      default: return null;
    }
  };

  return (
    <div className="flex h-screen overflow-hidden font-sans relative">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-[100] focus:px-4 focus:py-2 focus:rounded-full focus:bg-volt focus:text-white focus:text-sm focus:font-medium focus:shadow-volt"
      >
        Skip to content
      </a>
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        settings={userSettings}
        onSave={handleSaveSettings}
      />

      {wizardFlow === 'naming' && (
        <CampaignNameModal
          onCancel={closeWizard}
          onContinue={(name) => {
            setWizardInitialName(name);
            setWizardFlow('wizard');
          }}
        />
      )}

      {wizardFlow === 'wizard' && (
        <CampaignWizard
          initialName={wizardInitialName}
          initialLead={wizardInitialLead}
          onClose={closeWizard}
        />
      )}

      <motion.aside
        initial={{ x: -24, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        className="w-64 bg-white/[0.02] backdrop-blur-xl text-neutral-300 flex-shrink-0 hidden md:flex flex-col border-r border-white/10 z-20 relative"
      >
        <SidebarContent
          currentView={currentView}
          onViewChange={handleViewChange}
          onCompose={openCompose}
          onOpenSettings={openSettings}
          onCloseMobile={() => setIsMobileMenuOpen(false)}
          user={user}
          logout={logout}
          indicatorId="activeNavIndicator"
          scraperBusy={scraperBusy}
        />
      </motion.aside>

      <AnimatePresence>
        {isMobileMenuOpen && (
          <div className="fixed inset-0 z-50 flex md:hidden">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25 }}
              className="fixed inset-0 bg-noir/70 backdrop-blur-sm"
              onClick={() => setIsMobileMenuOpen(false)}
            />
            <motion.aside
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
              className="relative w-72 h-full bg-noir/95 backdrop-blur-xl text-neutral-300 flex flex-col border-r border-white/10 shadow-2xl"
            >
              <SidebarContent
                currentView={currentView}
                onViewChange={handleViewChange}
                onCompose={openCompose}
                onOpenSettings={openSettings}
                onCloseMobile={() => setIsMobileMenuOpen(false)}
                user={user}
                logout={logout}
                indicatorId="activeNavIndicatorMobile"
                scraperBusy={scraperBusy}
              />
            </motion.aside>
          </div>
        )}
      </AnimatePresence>

      <main id="main-content" className="flex-1 flex flex-col min-w-0 bg-transparent relative z-10">
        <header className="h-14 md:h-16 border-b border-white/10 flex items-center justify-between px-4 md:px-6 bg-white/[0.02] backdrop-blur-xl z-20 relative gap-3 md:gap-4">
          <div className="flex items-center gap-3 md:gap-4 overflow-hidden">
            <button
              onClick={() => setIsMobileMenuOpen(true)}
              aria-label="Open menu"
              className="md:hidden p-2 -ml-2 text-neutral-400 hover:text-white rounded-full active:bg-white/10 transition-colors duration-300"
            >
              <Menu className="w-6 h-6" />
            </button>

            <AnimatePresence mode="wait">
              <motion.h1
                key={VIEW_TITLES[currentView]}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                className="text-lg md:text-xl font-medium tracking-tight text-white truncate"
              >
                {VIEW_TITLES[currentView]}
              </motion.h1>
            </AnimatePresence>
          </div>

          <div className="flex items-center space-x-1 md:space-x-4 shrink-0">
             {userSettings.useRealApi ? (
                <span className="hidden md:flex text-xs font-medium text-volt-text bg-volt/10 px-2.5 py-1 rounded-full items-center animate-pulse-slow border border-volt/40">
                  <PlugZap className="w-3 h-3 mr-1" />
                  {userSettings.activeProvider === 'GMAIL' ? 'Gmail Live' :
                   userSettings.activeProvider === 'MICROSOFT' ? 'Outlook Live' :
                   'Zoho Live'}
                </span>
             ) : (
                <span className="hidden md:flex text-xs font-medium text-neutral-400 bg-white/[0.02] px-2.5 py-1 rounded-full items-center border border-white/10">
                  <span className="w-2 h-2 bg-green-500 rounded-full mr-2 shadow-[0_0_5px_rgba(34,197,94,0.5)]"></span>
                  Simulated
                </span>
             )}
             <button aria-label="Sync now" className="p-2 text-neutral-400 hover:text-volt-text transition-all hover:rotate-180 duration-500 rounded-full active:bg-white/10" title="Sync Now">
             <RefreshCcw className="w-5 h-5" />
            </button>
         </div>
        </header>

        {showGatewayWarning && (
          <div className="px-4 md:px-6 pt-3">
            <div className="flex items-start justify-between p-4 border border-amber-400/20 rounded-lg bg-amber-500/10 text-amber-100 backdrop-blur-sm">
              <div className="flex items-start space-x-3">
                <div className="p-2 rounded-full bg-amber-500/20 text-amber-200">
                  <AlertTriangle className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-sm font-semibold">Gateway unreachable or not configured.</p>
                  <p className="text-xs text-amber-200/80">Check server's ALLOWLIST_HOSTS and credentials (.env).</p>
                </div>
              </div>
              <button
                onClick={() => setShowGatewayWarning(false)}
                className="ml-4 text-amber-200 hover:text-white transition-colors duration-300"
                aria-label="Dismiss gateway warning"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        <AnimatePresence mode="wait">
          <ViewTransition key={currentView}>
            {renderView(currentView)}
          </ViewTransition>
        </AnimatePresence>
      </main>
    </div>
  );
};

const App: React.FC = () => {
  return (
    <CampaignProvider>
      <AppContent />
    </CampaignProvider>
  );
};

export default App;
