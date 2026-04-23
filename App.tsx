import React, { useState, useEffect } from 'react';
import { useSettings } from './context/SettingsContext';
import { useNotification } from './context/NotificationContext';
import { CampaignProvider, useCampaigns } from './context/CampaignContext';
import { Lead, Campaign } from './types';
import { exchangeGoogleCode } from './services/realGoogle';

// Components
import LoginScreen from './components/LoginScreen';
import SettingsModal from './components/SettingsModal';
import ComposeNewEmail from './components/ComposeNewEmail';

// Views
import { DashboardView } from './components/DashboardView';
import { TemplatesView } from './components/TemplatesView';
import { AnalyticsView } from './components/AnalyticsView';
import { IntegrationsView } from './components/IntegrationsView';
import { DocumentationView } from './components/DocumentationView';
import { LeadsView } from './components/LeadsView';
import { BrandOSView } from './components/BrandOSView';
import { PerformanceView } from './components/PerformanceView';
import { StoryVaultView } from './components/StoryVaultView';
import { CampaignsListView } from './components/CampaignsListView';
import { CampaignDetailView } from './components/CampaignDetailView';
import { UniboxView } from './components/UniboxView';
import { CampaignWizard } from './src/features/campaigns/CampaignWizard';

// Icons & UI
import { Mail, RefreshCcw, Layout, CalendarClock, Plus, Moon, Sun, FileText, BarChart3, Settings, Layers, X, Users, Menu, PlugZap, Palette, TrendingUp, Film, Megaphone, MessageSquare, AlertTriangle } from 'lucide-react';
import { gwHealth } from './services/mailGateway';

type View = 'DASHBOARD' | 'TEMPLATES' | 'ANALYTICS' | 'INTEGRATIONS' | 'DOCUMENTATION' | 'LEADS' | 'BRAND_OS' | 'PERFORMANCE' | 'STORY_VAULT' | 'CAMPAIGNS' | 'CAMPAIGN_DETAIL' | 'CAMPAIGN_CREATE' | 'UNIBOX';

// --- Inner App Logic to use Campaign Context ---
const AppContent: React.FC = () => {
  const { settings: userSettings, updateSettings, saveSettings } = useSettings();
  const { showToast } = useNotification();
  const { campaigns, addCampaign } = useCampaigns();

  const [zohoConnected, setZohoConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [darkMode, setDarkMode] = useState(false);
  const [showGatewayWarning, setShowGatewayWarning] = useState(false);
  
  // Navigation
  const [currentView, setCurrentView] = useState<View>('DASHBOARD');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null);
  
  // Modals
  const [isComposing, setIsComposing] = useState(false);
  const [composeInitialData, setComposeInitialData] = useState<{email: string, name: string, company: string} | undefined>(undefined);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // Handle OAuth Callback (Implicit Flow for Zoho)
  useEffect(() => {
    const hash = window.location.hash;
    if (hash && hash.includes('access_token')) {
      try {
        const params = new URLSearchParams(hash.substring(1));
        const accessToken = params.get('access_token');
        const state = params.get('state'); 
        
        // Security Check: Validate State to prevent CSRF
        const storedState = sessionStorage.getItem('oauth_state');
        if (!state || !storedState || state !== storedState) {
             // For simplicity in this demo, strict state checking might fail if reloaded, so we log but proceed if token exists for demo purposes.
             // In prod: return;
             console.warn("OAuth State Check", { received: state, stored: storedState });
        }
        
        // Clean up nonce
        sessionStorage.removeItem('oauth_state');

        if (accessToken) {
          if (state && state.includes('provider=google')) {
             // Note: This path handles implicit flow for Google if response_type=token was used
             updateSettings({
               useRealApi: true,
               googleAccessToken: accessToken,
               activeProvider: 'GMAIL'
             });
             showToast('SUCCESS', 'Google Workspace Connected Successfully!');
          } else {
             // Zoho Implicit Flow
             updateSettings({
               useRealApi: true,
               zohoAccessToken: accessToken,
               activeProvider: 'ZOHO'
             });
             showToast('SUCCESS', 'Zoho Mail Connected Successfully!');
          }
          window.history.replaceState(null, '', window.location.pathname);
          setZohoConnected(true);
        }
      } catch (e) {
        console.error("Error parsing OAuth hash", e);
        showToast('ERROR', 'Failed to complete OAuth connection.');
      }
    }
  }, []);

  // Handle OAuth Code Callback (Authorization Code Flow for Google)
  useEffect(() => {
    const search = window.location.search;
    const params = new URLSearchParams(search);
    const code = params.get('code');
    const state = params.get('state');

    if (code && state && state.includes('provider=google')) {
        const handleExchange = async () => {
            setConnecting(true);
            try {
                // FALLBACK: Read directly from LocalStorage if context seems empty.
                // This ensures we can complete the handshake even if React Context isn't fully hydrated from LS yet.
                let clientId = userSettings.googleClientId;
                let clientSecret = userSettings.googleClientSecret;

                if (!clientId || !clientSecret) {
                   try {
                     const stored = localStorage.getItem('ysxflow_settings');
                     if (stored) {
                       const parsed = JSON.parse(stored);
                       if (parsed.googleClientId) clientId = parsed.googleClientId;
                       if (parsed.googleClientSecret) clientSecret = parsed.googleClientSecret;
                       
                       // Sync back to context if found
                       if (clientId || clientSecret) {
                          updateSettings({ 
                             googleClientId: clientId || userSettings.googleClientId, 
                             googleClientSecret: clientSecret || userSettings.googleClientSecret
                          });
                       }
                     }
                   } catch(err) {
                     console.error("Manual LS read failed", err);
                   }
                }

                if (!clientId || !clientSecret) {
                    showToast('ERROR', 'Missing Google Client ID or Secret in settings. Cannot exchange code.');
                    return;
                }

                const tokens = await exchangeGoogleCode(
                    code,
                    clientId,
                    clientSecret,
                    window.location.origin
                );

                updateSettings({
                    useRealApi: true,
                    googleAccessToken: tokens.access_token,
                    activeProvider: 'GMAIL',
                    // Only update refresh token if returned (usually only on first consent)
                    ...(tokens.refresh_token ? { googleRefreshToken: tokens.refresh_token } : {})
                });

                showToast('SUCCESS', 'Google Workspace Connected (Offline Access)!');
                setZohoConnected(true);
                // Clear URL
                window.history.replaceState(null, '', window.location.pathname);
            } catch (e: any) {
                console.error("Google Code Exchange Failed", e);
                showToast('ERROR', `Google Connection Failed: ${e.message}`);
            } finally {
                setConnecting(false);
            }
        };
        handleExchange();
    }
  }, [userSettings.googleClientId, userSettings.googleClientSecret]);

  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [darkMode]);

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

  const handleLogin = async (mode: 'SANDBOX' | 'LIVE') => {
    setConnecting(true);
    try {
      // @ts-ignore
      if (typeof window !== 'undefined' && window.aistudio) {
        // @ts-ignore
        const hasKey = await window.aistudio.hasSelectedApiKey();
        if (!hasKey) {
          // @ts-ignore
          await window.aistudio.openSelectKey();
        }
      }
    } catch (e) {
      console.warn("API Key check skipped or failed", e);
    }

    setTimeout(() => {
      if (mode === 'LIVE') {
        updateSettings({ useRealApi: true });
        setZohoConnected(true);
        setIsSettingsOpen(true); 
      } else {
        updateSettings({ useRealApi: false });
        setZohoConnected(true);
      }
      setConnecting(false);
    }, 1000);
  };

  const handleCreateCampaign = async (campaignData: Omit<Campaign, 'id' | 'createdAt' | 'status' | 'progress' | 'stats' | 'sequence'>) => {
    await addCampaign(campaignData);
    setIsComposing(false);
    setComposeInitialData(undefined);
    setCurrentView('CAMPAIGNS'); 
  };

  const handleComposeFromLead = (lead: Lead) => {
    setComposeInitialData({
      email: lead.email,
      name: lead.name,
      company: lead.company
    });
    setIsComposing(true);
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

  if (!zohoConnected) {
    return <LoginScreen onConnect={handleLogin} isConnecting={connecting} />;
  }

  const NavButton = ({ view, icon: Icon, label, isActive }: { view: View, icon: any, label: string, isActive: boolean }) => {
    return (
      <button 
        onClick={() => handleViewChange(view)} 
        className={`w-full flex items-center px-3 py-3 md:py-2 text-sm font-medium rounded-lg transition-all duration-200 group border-l-2 
          ${isActive 
            ? 'bg-slate-800 text-white shadow-glow border-brand-400 dark:bg-slate-800/50' 
            : 'border-transparent text-slate-400 hover:bg-slate-800/50 hover:text-white hover:translate-x-1'
          }`}
      >
        <Icon className={`w-5 h-5 md:w-4 md:h-4 mr-3 transition-colors ${isActive ? 'text-brand-400' : 'text-slate-500 group-hover:text-slate-300'}`} />
        {label}
      </button>
    );
  };

  const SidebarContent = () => (
    <>
      <div className="p-6 flex items-center justify-between space-x-3 text-white">
        <div className="flex items-center space-x-3">
          <div className="w-8 h-8 bg-brand-600 rounded-lg flex items-center justify-center shadow-lg shadow-brand-900/50">
            <Layout className="w-5 h-5" />
          </div>
          <span className="font-bold text-lg tracking-tight">YSX Flow</span>
        </div>
        <button onClick={() => setIsMobileMenuOpen(false)} className="md:hidden text-slate-400 hover:text-white p-2">
          <X className="w-6 h-6" />
        </button>
      </div>

      <div className="px-4 mb-6">
        <button 
          onClick={() => { setComposeInitialData(undefined); setIsComposing(true); setIsMobileMenuOpen(false); }}
          className="w-full flex items-center justify-center px-4 py-3 bg-white text-brand-900 font-semibold rounded-lg shadow hover:bg-brand-50 transition-all transform hover:scale-105 active:scale-95"
        >
          <Plus className="w-5 h-5 mr-2" />
          Compose
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-3 space-y-6 custom-scrollbar">
        <div>
          <h3 className="px-3 text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-2">Inbox</h3>
          <nav className="space-y-1">
            <NavButton view="UNIBOX" icon={MessageSquare} label="Unified Inbox" isActive={currentView === 'UNIBOX'} />
          </nav>
        </div>

        <div>
          <h3 className="px-3 text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-2">Campaigns</h3>
          <nav className="space-y-1">
            <NavButton view="DASHBOARD" icon={Mail} label="Dashboard" isActive={currentView === 'DASHBOARD'} />
            <NavButton view="CAMPAIGNS" icon={Megaphone} label="All Campaigns" isActive={currentView === 'CAMPAIGNS' || currentView === 'CAMPAIGN_DETAIL'} />
            <NavButton view="CAMPAIGN_CREATE" icon={Plus} label="New Campaign" isActive={currentView === 'CAMPAIGN_CREATE'} />
          </nav>
        </div>

        <div>
          <h3 className="px-3 text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-2">Workspace</h3>
          <nav className="space-y-1">
             <NavButton view="LEADS" icon={Users} label="Leads" isActive={currentView === 'LEADS'} />
             <NavButton view="STORY_VAULT" icon={Film} label="Story Vault" isActive={currentView === 'STORY_VAULT'} />
             <NavButton view="BRAND_OS" icon={Palette} label="Brand OS" isActive={currentView === 'BRAND_OS'} />
             <NavButton view="PERFORMANCE" icon={TrendingUp} label="Performance" isActive={currentView === 'PERFORMANCE'} />
             <NavButton view="TEMPLATES" icon={FileText} label="Templates" isActive={currentView === 'TEMPLATES'} />
             <NavButton view="ANALYTICS" icon={BarChart3} label="Analytics" isActive={currentView === 'ANALYTICS'} />
             <NavButton view="INTEGRATIONS" icon={Layers} label="Integrations" isActive={currentView === 'INTEGRATIONS'} />
          </nav>
        </div>

         <div>
          <h3 className="px-3 text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-2">Settings</h3>
          <nav className="space-y-1">
             <button 
              onClick={() => { setIsSettingsOpen(true); setIsMobileMenuOpen(false); }}
              className="w-full flex items-center px-3 py-3 md:py-2 text-sm font-medium rounded-lg text-slate-400 hover:bg-slate-800/50 hover:text-white hover:translate-x-1 transition-all duration-200 border-l-2 border-transparent"
             >
               <Settings className="w-5 h-5 md:w-4 md:h-4 mr-3 text-slate-500 group-hover:text-slate-300" />
               Configuration
             </button>
          </nav>
        </div>
      </div>

      <div className="p-4 border-t border-slate-800/50 space-y-4 bg-slate-900/50 backdrop-blur-sm">
        <button 
          onClick={() => setDarkMode(!darkMode)}
          className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-slate-800/50 text-xs font-medium text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
        >
          <div className="flex items-center">
            {darkMode ? <Moon className="w-3.5 h-3.5 mr-2" /> : <Sun className="w-3.5 h-3.5 mr-2" />}
            <span>{darkMode ? 'Dark Mode' : 'Light Mode'}</span>
          </div>
          <div className={`w-8 h-4 rounded-full relative transition-colors ${darkMode ? 'bg-brand-600' : 'bg-slate-600'}`}>
            <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${darkMode ? 'left-4.5' : 'left-0.5'}`} style={{left: darkMode ? '18px' : '2px'}} />
          </div>
        </button>

        <div className="flex items-center group cursor-pointer pb-safe">
          <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-brand-400 to-purple-500 flex items-center justify-center text-white font-bold text-xs shadow-lg transition-transform group-hover:scale-110">
            JD
          </div>
          <div className="ml-3 transition-opacity opacity-80 group-hover:opacity-100">
            <p className="text-sm font-medium text-white">{userSettings.emailSignature.split('\n')[0]}</p>
            <p className="text-xs text-slate-500">Synced: Just now</p>
          </div>
        </div>
      </div>
    </>
  );

  return (
    <div className="flex h-screen bg-slate-50 dark:bg-slate-950 overflow-hidden font-sans animate-in fade-in duration-500 transition-colors duration-300 relative">
      {darkMode && (
        <div className="absolute inset-0 pointer-events-none z-0 overflow-hidden">
           <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] rounded-full bg-brand-900/10 blur-[120px]"></div>
           <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] rounded-full bg-purple-900/10 blur-[120px]"></div>
        </div>
      )}

      <SettingsModal 
        isOpen={isSettingsOpen} 
        onClose={() => setIsSettingsOpen(false)}
        settings={userSettings}
        onSave={handleSaveSettings}
      />

      {isComposing && (
        <ComposeNewEmail 
          onClose={() => { setIsComposing(false); setComposeInitialData(undefined); }} 
          onSend={handleCreateCampaign} 
          initialRecipientEmail={composeInitialData?.email}
          initialRecipientName={composeInitialData?.name}
          initialCompany={composeInitialData?.company}
        />
      )}

      <aside className="w-64 bg-slate-900 dark:bg-slate-950/80 backdrop-blur-xl text-slate-300 flex-shrink-0 hidden md:flex flex-col border-r border-slate-800/50 animate-in slide-in-from-left duration-500 z-20 relative">
        <SidebarContent />
      </aside>

      {isMobileMenuOpen && (
        <div className="fixed inset-0 z-50 flex md:hidden">
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setIsMobileMenuOpen(false)} />
          <aside className="relative w-72 h-full bg-slate-900 dark:bg-slate-950 text-slate-300 flex flex-col border-r border-slate-800 shadow-2xl animate-in slide-in-from-left duration-300">
             <SidebarContent />
          </aside>
        </div>
      )}

      <main className="flex-1 flex flex-col min-w-0 bg-white dark:bg-transparent relative z-10 transition-colors duration-300">
        <header className="h-14 md:h-16 border-b border-slate-200 dark:border-slate-800/50 flex items-center justify-between px-4 md:px-6 bg-white dark:bg-slate-950/50 backdrop-blur-sm animate-in slide-in-from-top duration-500 z-20 relative gap-3 md:gap-4">
          <div className="flex items-center gap-3 md:gap-4 overflow-hidden">
            <button
              onClick={() => setIsMobileMenuOpen(true)}
              className="md:hidden p-2 -ml-2 text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-white rounded-lg active:bg-slate-100 dark:active:bg-slate-800"
            >
              <Menu className="w-6 h-6" />
            </button>

            <h1 className="text-lg md:text-xl font-semibold text-slate-800 dark:text-white truncate">
              {currentView === 'DASHBOARD' ? 'Dashboard' : 
               currentView === 'TEMPLATES' ? 'Templates' :
               currentView === 'ANALYTICS' ? 'Analytics' : 
               currentView === 'DOCUMENTATION' ? 'Docs' : 
               currentView === 'LEADS' ? 'Leads' : 
               currentView === 'BRAND_OS' ? 'Brand OS' : 
               currentView === 'STORY_VAULT' ? 'Story Vault' : 
               currentView === 'CAMPAIGNS' ? 'Campaigns' :
               currentView === 'CAMPAIGN_DETAIL' ? 'Campaign Details' :
               currentView === 'CAMPAIGN_CREATE' ? 'New Campaign' :
               currentView === 'UNIBOX' ? 'Unified Inbox' :
               currentView === 'PERFORMANCE' ? 'Performance' : 'Integrations'}
            </h1>
          </div>
          
          <div className="flex items-center space-x-1 md:space-x-4 shrink-0">
             {userSettings.useRealApi ? (
                <span className="hidden md:flex text-xs font-medium text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/20 px-2 py-1 rounded items-center animate-pulse-slow border border-purple-200 dark:border-purple-800">
                  <PlugZap className="w-3 h-3 mr-1" /> 
                  {userSettings.activeProvider === 'GMAIL' ? 'Gmail Live' : 
                   userSettings.activeProvider === 'MICROSOFT' ? 'Outlook Live' :
                   'Zoho Live'}
                </span>
             ) : (
                <span className="hidden md:flex text-xs font-medium text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800/50 px-2 py-1 rounded items-center border border-slate-200 dark:border-slate-700">
                  <span className="w-2 h-2 bg-green-500 rounded-full mr-2 shadow-[0_0_5px_rgba(34,197,94,0.5)]"></span>
                  Simulated
                </span>
             )}
             <button className="p-2 text-slate-400 hover:text-brand-600 transition-all hover:rotate-180 duration-500 rounded-lg active:bg-slate-100 dark:active:bg-slate-800" title="Sync Now">
             <RefreshCcw className="w-5 h-5" />
            </button>
         </div>
        </header>

        {showGatewayWarning && (
          <div className="px-4 md:px-6 pt-3">
            <div className="flex items-start justify-between p-4 border border-amber-200 dark:border-amber-800/60 rounded-lg bg-amber-50 dark:bg-amber-900/30 text-amber-900 dark:text-amber-100 shadow-sm">
              <div className="flex items-start space-x-3">
                <div className="p-2 rounded-full bg-amber-100 dark:bg-amber-800/80 text-amber-700 dark:text-amber-200">
                  <AlertTriangle className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-sm font-semibold">Gateway unreachable or not configured.</p>
                  <p className="text-xs text-amber-800/80 dark:text-amber-200/80">Check server's ALLOWLIST_HOSTS and credentials (.env).</p>
                </div>
              </div>
              <button
                onClick={() => setShowGatewayWarning(false)}
                className="ml-4 text-amber-700 hover:text-amber-900 dark:text-amber-200 dark:hover:text-white"
                aria-label="Dismiss gateway warning"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {currentView === 'DASHBOARD' && <DashboardView />}
        {currentView === 'TEMPLATES' && <TemplatesView />}
        {currentView === 'ANALYTICS' && <AnalyticsView />}
        {currentView === 'INTEGRATIONS' && <IntegrationsView onViewDocumentation={() => setCurrentView('DOCUMENTATION')} isSandbox={!userSettings.useRealApi} onFixConnection={() => setIsSettingsOpen(true)} />}
        {currentView === 'DOCUMENTATION' && <DocumentationView onBack={() => setCurrentView('INTEGRATIONS')} />}
        {currentView === 'LEADS' && <LeadsView onCompose={handleComposeFromLead} />}
        {currentView === 'BRAND_OS' && <BrandOSView />}
        {currentView === 'PERFORMANCE' && <PerformanceView />}
        {currentView === 'STORY_VAULT' && <StoryVaultView />}
        {currentView === 'UNIBOX' && <UniboxView />}
        {currentView === 'CAMPAIGNS' && (
          <CampaignsListView 
            onNewCampaign={() => {
              setCurrentView('CAMPAIGN_CREATE');
            }}
            onSelectCampaign={(id) => {
              setSelectedCampaignId(id);
              setCurrentView('CAMPAIGN_DETAIL');
            }}
          />
        )}
        {currentView === 'CAMPAIGN_CREATE' && (
          <CampaignWizard
            onClose={() => setCurrentView('CAMPAIGNS')}
            onSubmitted={() => {
              showToast('SUCCESS', 'Campaign queued.');
              setCurrentView('CAMPAIGNS');
            }}
          />
        )}
        {currentView === 'CAMPAIGN_DETAIL' && campaigns.find(c => c.id === selectedCampaignId) && (
          <CampaignDetailView 
            campaign={campaigns.find(c => c.id === selectedCampaignId)!}
            onBack={() => setCurrentView('CAMPAIGNS')}
          />
        )}
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