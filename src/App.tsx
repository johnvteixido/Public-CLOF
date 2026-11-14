import React, { useState, useEffect } from 'react';
import { 
  Building2, Briefcase, Mail, BookOpen, Sparkles, Plus, Trash2, Copy, Check, 
  Globe, MapPin, Sliders, UserCheck, Compass, HelpCircle, CheckCircle2, 
  ListFilter, Send, Share2, FileText, X, ChevronRight, RefreshCw, AlertCircle, FileJson, Clock
} from 'lucide-react';
import { ClientLead, SearchQuery, UserProfile } from './types';
import LeadGeneratorForm from './components/LeadGeneratorForm';
import LeadCard from './components/LeadCard';
import PitchStrategyView from './components/PitchStrategyView';
import OutreachCustomizer from './components/OutreachCustomizer';
import LeadMap from './components/LeadMap';
import * as api from './lib/api';

const INITIAL_PROFILE: UserProfile = {
  fullName: '',
  title: '',
  portfolioUrl: '',
  email: '',
  specialties: [],
  customRate: '',
  physicalAddress: '',
};

export default function App() {
  const [authStatus, setAuthStatus] = useState<"checking" | "signed-out" | "signed-in">("checking");
  const [authConfigured, setAuthConfigured] = useState<boolean | null>(null);
  const [authError, setAuthError] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [isSigningIn, setIsSigningIn] = useState(false);

  useEffect(() => {
    let mounted = true;
    api.getSession()
      .then((session) => {
        if (!mounted) return;
        setAuthConfigured(session.configured);
        setAuthStatus(session.authenticated ? "signed-in" : "signed-out");
      })
      .catch((error) => {
        if (!mounted) return;
        setAuthError(error instanceof Error ? error.message : "Unable to check the application session.");
        setAuthStatus("signed-out");
      });
    return () => { mounted = false; };
  }, []);

  const [profile, setProfile] = useState<UserProfile>(() => {
    const saved = localStorage.getItem('lead_engine_profile');
    return saved ? JSON.parse(saved) : INITIAL_PROFILE;
  });

  const [leads, setLeads] = useState<ClientLead[]>(() => {
    const saved = localStorage.getItem('lead_engine_saved_leads');
    return saved ? JSON.parse(saved) : [];
  });

  const [dbConnected, setDbConnected] = useState(false);
  const [gmailConnected, setGmailConnected] = useState(false);
  const [gmailEmail, setGmailEmail] = useState<string | null>(null);

  useEffect(() => {
    if (authStatus !== "signed-in") return;
    let mounted = true;
    (async () => {
      const [leadsResult, profileResult] = await Promise.allSettled([
        api.listLeads(),
        api.getProfile(),
      ]);
      if (!mounted) return;
      if (leadsResult.status === 'fulfilled') {
        setDbConnected(true);
        setLeads(leadsResult.value);
      } else if (!(leadsResult.reason instanceof api.DbNotConfiguredError)) {
        console.warn('Failed to load prospects from API; using local cache.', leadsResult.reason);
      }
      if (profileResult.status === 'fulfilled') {
        setDbConnected(true);
        // The singleton database row starts blank. Never invent owner identity
        // or overwrite an existing profile just because optional fields are empty.
        setProfile(profileResult.value);
      } else if (!(profileResult.reason instanceof api.DbNotConfiguredError)) {
        console.warn('Failed to load outreach settings from API; using local defaults.', profileResult.reason);
      }
    })();
    return () => { mounted = false; };
  }, [authStatus]);

  useEffect(() => {
    if (authStatus !== "signed-in") return;
    let mounted = true;
    const refreshGmailStatus = async () => {
      try {
        const response = await fetch('/api/gmail/status', { credentials: 'same-origin' });
        if (!response.ok) return;
        const status = await response.json() as { connected?: boolean; email?: string };
        if (mounted) {
          setGmailConnected(Boolean(status.connected));
          setGmailEmail(status.email ?? null);
        }
      } catch (error) {
        console.warn('Unable to load Gmail connection status.', error);
      }
    };
    void refreshGmailStatus();
    return () => { mounted = false; };
  }, [authStatus]);

  const [activeTab, setActiveTab] = useState<'prospect' | 'pipeline' | 'outreach'>('prospect');
  const [pipelineView, setPipelineView] = useState<'grid' | 'map'>('grid');
  const [isLoadingLeads, setIsLoadingLeads] = useState(false);
  const [groundingSources, setGroundingSources] = useState<{ title: string; uri: string }[]>([]);
  const [lastRawAnalysis, setLastRawAnalysis] = useState<string>('');

  const [searchFilter, setSearchFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<'All' | ClientLead['status']>('All');
  const [copiedLeadId, setCopiedLeadId] = useState<string | null>(null);

  // Interactive panels
  const [selectedLeadForStrategy, setSelectedLeadForStrategy] = useState<ClientLead | null>(null);
  const [selectedLeadForCustomizer, setSelectedLeadForCustomizer] = useState<ClientLead | null>(null);

  // Manual Quick Add leads state
  const [showManualAdd, setShowManualAdd] = useState(false);
  const [manualName, setManualName] = useState('');
  const [manualWebsite, setManualWebsite] = useState('');
  const [manualIndustry, setManualIndustry] = useState('');
  const [manualLocation, setManualLocation] = useState('');
  const [manualDesc, setManualDesc] = useState('');
  const [manualNeeds, setManualNeeds] = useState('');
  const [manualStack, setManualStack] = useState('');
  const [manualEmail, setManualEmail] = useState('');
  const [manualPerson, setManualPerson] = useState('');

  // Persist storage whenever leads state updates
  useEffect(() => {
    localStorage.setItem('lead_engine_saved_leads', JSON.stringify(leads));
  }, [leads]);

  function syncToServer<T>(fn: () => Promise<T>, label: string): void {
    if (!dbConnected) return;
    fn().catch((err) => console.warn(`Server sync (${label}) failed:`, err));
  }

  const handleSaveProfile = (updatedProfile: UserProfile) => {
    setProfile(updatedProfile);
    localStorage.setItem('lead_engine_profile', JSON.stringify(updatedProfile));
    syncToServer(() => api.updateProfile(updatedProfile), 'profile');
  };

  const handleStatusChange = (id: string, status: ClientLead['status']) => {
    setLeads(prev => prev.map(lead => lead.id === id ? { ...lead, status } : lead));
    if (selectedLeadForStrategy && selectedLeadForStrategy.id === id) {
      setSelectedLeadForStrategy(prev => prev ? { ...prev, status } : null);
    }
    if (selectedLeadForCustomizer && selectedLeadForCustomizer.id === id) {
      setSelectedLeadForCustomizer(prev => prev ? { ...prev, status } : null);
    }
    syncToServer(() => api.updateLead(id, { status }), 'status');
  };

  const handleNotesChange = (id: string, notes: string) => {
    setLeads(prev => prev.map(lead => lead.id === id ? { ...lead, notes } : lead));
    if (selectedLeadForStrategy && selectedLeadForStrategy.id === id) {
      setSelectedLeadForStrategy(prev => prev ? { ...prev, notes } : null);
    }
    if (selectedLeadForCustomizer && selectedLeadForCustomizer.id === id) {
      setSelectedLeadForCustomizer(prev => prev ? { ...prev, notes } : null);
    }
    syncToServer(() => api.updateLead(id, { notes }), 'notes');
  };

  const handleUpdateTemplate = (id: string, outreachTemplate: string) => {
    setLeads(prev => prev.map(lead => lead.id === id ? { ...lead, outreachTemplate } : lead));
    if (selectedLeadForStrategy && selectedLeadForStrategy.id === id) {
      setSelectedLeadForStrategy(prev => prev ? { ...prev, outreachTemplate } : null);
    }
    if (selectedLeadForCustomizer && selectedLeadForCustomizer.id === id) {
      setSelectedLeadForCustomizer(prev => prev ? { ...prev, outreachTemplate } : null);
    }
    syncToServer(() => api.updateLead(id, { outreachTemplate }), 'template');
  };

  const handleDeleteLead = (id: string) => {
    if (confirm("Are you sure you want to remove this client from your CRM logs?")) {
      setLeads(prev => prev.filter(lead => lead.id !== id));
      if (selectedLeadForStrategy?.id === id) setSelectedLeadForStrategy(null);
      if (selectedLeadForCustomizer?.id === id) setSelectedLeadForCustomizer(null);
      syncToServer(() => api.deleteLead(id), 'delete');
    }
  };

  const clearPipeline = () => {
    if (confirm("Reset CRM database back to empty?")) {
      setLeads([]);
      localStorage.removeItem('lead_engine_saved_leads');
      setSelectedLeadForStrategy(null);
      setSelectedLeadForCustomizer(null);
    }
  };

  // Setup search fn for LeadGeneratorForm
  const handleSearchAILeads = async (query: SearchQuery) => {
    setIsLoadingLeads(true);
    setGroundingSources([]);
    setLastRawAnalysis('');
    
    // Switch tab to let them watch the outcome or filter
    setActiveTab('pipeline');
    setSelectedLeadForStrategy(null);
    setSelectedLeadForCustomizer(null);

    try {
      const data = await api.postJson<{
        leads: ClientLead[];
        groundingSources: { title: string; uri: string }[];
        rawAnalysis: string;
        warnings: string[];
      }>('/generate-leads', { ...query, profile });
      
      if (data.leads && data.leads.length > 0) {
        const existingNames = new Set(leads.map(l => l.name.toLowerCase()));
        const newLeads = data.leads.filter((l: ClientLead) => !existingNames.has(l.name.toLowerCase()));
        setLeads(prev => [...newLeads, ...prev]);
        setGroundingSources(data.groundingSources || []);
        setLastRawAnalysis(data.rawAnalysis || '');

        if (dbConnected && newLeads.length > 0) {
          Promise.all(newLeads.map((l: ClientLead) => {
            const { id: _unused, ...payload } = l;
            void _unused;
            return api.createLead(payload).then((created) => ({ tmpId: l.id, created }));
          }))
            .then((results) => {
              setLeads(prev => prev.map(l => {
                const match = results.find(r => r.tmpId === l.id);
                return match ? match.created : l;
              }));
            })
            .catch((err) => console.warn('Server sync (search results) failed:', err));
        }
      } else {
        alert("The scout found no verifiable matches for this run. Try again later; no sample leads were fabricated.");
      }
    } catch (error: any) {
      console.error(error);
      alert(`Search failed: ${error.message || 'Error communicating with DuckDuckGo index.'}`);
    } finally {
      setIsLoadingLeads(false);
    }
  };

  // Add manually defined client
  const handleManualAddSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualName || !manualEmail) {
      alert("Company Name and Contact Email are required.");
      return;
    }

    const newLead: ClientLead = {
      id: `lead-manual-${Date.now()}`,
      name: manualName,
      website: manualWebsite || 'N/A',
      industry: manualIndustry || 'General Software Needs',
      location: manualLocation || 'Remote / Worldwide',
      description: manualDesc || 'Local business seeking digital systems modernizations.',
      potentialNeeds: manualNeeds ? manualNeeds.split(',').map(n => n.trim()) : ['Upgrade legacy software systems', 'Create high-fidelity website', 'Automate manual sheets operations'],
      suggestedStack: manualStack ? manualStack.split(',').map(s => s.trim()) : ['React', 'TypeScript', 'Node.js', 'TailwindCSS'],
      contactEmail: manualEmail,
      contactPerson: manualPerson || 'Business Owner',
      outreachTemplate: `Subject: Tailored software solutions for ${manualName}

Hi ${manualPerson || 'Business Owner'},

I came across ${manualName} and noticed you could optimize your systems with automated integrations. I specialize in custom software engineering—specifically full-stack TypeScript solutions.

Let's discuss how we can build customized panels to save your employees hours on admin work.

Regards,
[My Name]`,
      status: 'Lead',
      notes: 'Manually logged client.',
      dateAdded: new Date().toISOString().split('T')[0] ?? new Date().toISOString().slice(0, 10),
      source: 'Manual'
    };

    setLeads(prev => [newLead, ...prev]);
    setShowManualAdd(false);

    if (dbConnected) {
      const { id: _unused, ...payload } = newLead;
      void _unused;
      api.createLead(payload)
        .then((created) => {
          setLeads(prev => prev.map(l => l.id === newLead.id ? created : l));
        })
        .catch((err) => console.warn('Server sync (create) failed:', err));
    }

    setManualName('');
    setManualWebsite('');
    setManualIndustry('');
    setManualLocation('');
    setManualDesc('');
    setManualNeeds('');
    setManualStack('');
    setManualEmail('');
    setManualPerson('');
  };

  // Export JSON pipeline representation
  const handleExportJSON = () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(leads, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", "lead_pipeline_export.json");
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  // Compute stats metrics
  const totalLeadsCount = leads.length;
  const inDiscussionCount = leads.filter(l => l.status === 'In Discussion' || l.status === 'Replied').length;
  const totalNeedsCount = leads.flatMap(l => l.potentialNeeds).length;
  
  const filteredLeads = leads.filter(lead => {
    const matchesSearch = lead.name.toLowerCase().includes(searchFilter.toLowerCase()) ||
                          lead.industry.toLowerCase().includes(searchFilter.toLowerCase()) ||
                          lead.location.toLowerCase().includes(searchFilter.toLowerCase()) ||
                          lead.description.toLowerCase().includes(searchFilter.toLowerCase());
    const matchesStatus = statusFilter === 'All' ? true : lead.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const handleSignIn = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSigningIn(true);
    setAuthError("");
    try {
      const session = await api.login(loginPassword);
      setAuthConfigured(session.configured);
      setLoginPassword("");
      setAuthStatus("signed-in");
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Sign-in failed.");
    } finally {
      setIsSigningIn(false);
    }
  };

  const handleSignOut = async () => {
    try {
      await api.logout();
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Unable to end the server session. Please retry.");
      return;
    }

    // Only show the signed-out state after the server confirms cookie expiry.
    // Clear this browser's cached prospect and profile data as well.
    localStorage.removeItem('lead_engine_saved_leads');
    localStorage.removeItem('lead_engine_profile');
    setLeads([]);
    setProfile(INITIAL_PROFILE);
    setAuthError("");
    setAuthStatus("signed-out");
    setGmailConnected(false);
    setGmailEmail(null);
  };

  if (authStatus !== "signed-in") {
    return (
      <main className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-6">
        <section className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-8 shadow-2xl">
          <div className="mb-6 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-600 text-lg font-bold">T</div>
            <div>
              <h1 className="text-lg font-semibold text-white">Teixido Labs</h1>
              <p className="text-xs text-slate-400">Private prospecting workspace</p>
            </div>
          </div>
          {authStatus === "checking" ? (
            <p className="text-sm text-slate-300">Checking your secure session…</p>
          ) : !authConfigured ? (
            <div className="space-y-3">
              <p className="text-sm font-semibold text-amber-300">Application authentication is not configured.</p>
              <p className="text-sm leading-relaxed text-slate-300">
                Set APP_ACCESS_PASSWORD (at least 16 characters), APP_SESSION_SECRET (at least 32 characters), and APP_URL in the server environment, then restart or redeploy.
              </p>
            </div>
          ) : (
            <form onSubmit={handleSignIn} className="space-y-4">
              <div>
                <label htmlFor="app-access-password" className="mb-2 block text-sm font-medium text-slate-200">Workspace password</label>
                <input
                  id="app-access-password"
                  type="password"
                  autoComplete="current-password"
                  value={loginPassword}
                  onChange={(event) => setLoginPassword(event.target.value)}
                  required
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-3 text-sm text-white outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
                />
              </div>
              {authError && <p role="alert" className="text-sm text-rose-300">{authError}</p>}
              <button
                type="submit"
                disabled={isSigningIn || loginPassword.length === 0}
                className="w-full rounded-lg bg-indigo-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSigningIn ? "Signing in…" : "Sign in"}
              </button>
            </form>
          )}
          {authError && !authConfigured && <p role="alert" className="mt-4 text-xs text-rose-300">{authError}</p>}
        </section>
      </main>
    );
  }

  return (
    <div className="flex flex-col md:flex-row h-screen w-full bg-slate-50 font-sans text-slate-900 overflow-hidden">
      
      {/* SIDEBAR NAVIGATION (POLISHED SLATE STYLING) */}
      <aside className="w-full md:w-64 bg-slate-900 text-slate-300 flex flex-col border-r border-slate-800 shrink-0 select-none">
        
        {/* LOGO BOX BRANDING */}
        <div className="p-6 border-b border-slate-800">
          <div className="flex items-center gap-3 text-white mb-1">
            <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center font-bold text-lg shadow-md tracking-wider">L</div>
            <span className="font-semibold tracking-tight text-xl">TEIXIDO LABS</span>
          </div>
          <p className="text-[10px] text-slate-500 font-medium">PERSONAL PROSPECTING WORKSTATION</p>
        </div>

        {/* NAVIGATION PANEL */}
        <div className="p-6 flex-1 space-y-6">
          <div>
            <span className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-3">Workspace</span>
            <nav className="space-y-1">
              <button
                type="button"
                id="sidebar-tab-prospect"
                onClick={() => {
                  setActiveTab('prospect');
                  setSelectedLeadForStrategy(null);
                  setSelectedLeadForCustomizer(null);
                }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all cursor-pointer ${
                  activeTab === 'prospect'
                    ? 'bg-indigo-600 text-white shadow-md shadow-indigo-900/30 font-bold'
                    : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-105'
                }`}
              >
                <Compass className="w-4.5 h-4.5" />
                <span>Search Prospects</span>
              </button>

              <button
                type="button"
                id="sidebar-tab-pipeline"
                onClick={() => {
                  setActiveTab('pipeline');
                  setSelectedLeadForStrategy(null);
                  setSelectedLeadForCustomizer(null);
                }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all cursor-pointer ${
                  activeTab === 'pipeline'
                    ? 'bg-indigo-600 text-white shadow-md shadow-indigo-900/30 font-bold'
                    : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-105'
                }`}
              >
                <Building2 className="w-4.5 h-4.5" />
                <span>Client Pipeline</span>
                {totalLeadsCount > 0 && (
                  <span className="ml-auto bg-slate-800 text-slate-300 text-[11px] px-2 py-0.5 rounded-full font-mono">
                    {totalLeadsCount}
                  </span>
                )}
              </button>

              <button
                type="button"
                id="sidebar-tab-outreach"
                onClick={() => {
                  setActiveTab('outreach');
                  setSelectedLeadForStrategy(null);
                  setSelectedLeadForCustomizer(null);
                }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all cursor-pointer ${
                  activeTab === 'outreach'
                    ? 'bg-indigo-600 text-white shadow-md shadow-indigo-900/30 font-bold'
                    : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-105'
                }`}
              >
                <Mail className="w-4.5 h-4.5" />
                <span>Outreach Logs</span>
              </button>

            </nav>
          </div>

          {/* QUICK CREDENTIALS NOTIFICATION */}
          <div className="bg-slate-800/50 rounded-xl p-3 border border-slate-800 text-[11px] leading-relaxed text-slate-400 space-y-1.5">
            <div className="text-slate-200 font-bold flex items-center gap-1">
              <Clock className="w-3.5 h-3.5 text-indigo-400" /> Workspace Status
            </div>
            <p>{dbConnected ? 'Persistent database connected.' : 'Connecting to the persistent workspace…'}</p>
          </div>
        </div>

        {/* BOTTOM METRIC CARD */}
        <div className="mt-auto p-6 border-t border-slate-800/80">
          <div className="bg-slate-800/80 rounded-xl p-4 border border-slate-800">
            <p className="text-xs text-slate-400 mb-1">Prospecting Workload</p>
            <p className="text-sm font-semibold text-white mb-3">Owner workstation</p>
            <div className="w-full bg-slate-700 h-1.5 rounded-full mb-1">
              <div 
                className="bg-indigo-500 h-1.5 rounded-full transition-all duration-500" 
                style={{ width: `${Math.min(100, (totalLeadsCount / 8) * 100)}%` }}
              ></div>
            </div>
            <div className="flex justify-between text-[10px] text-slate-400 font-mono mt-1">
              <span>{totalLeadsCount} saved prospects</span>
              <span>8 prospect daily target</span>
            </div>
          </div>
        </div>
      </aside>

      {/* MAIN LAYOUT CANVAS CONTAINER */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        
        {/* ACTION BAR HEADER */}
        <header className="h-16 bg-white border-b border-slate-100 px-6 md:px-8 flex items-center justify-between shadow-sm shrink-0 select-none">
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono font-bold bg-indigo-50 text-indigo-700 py-1 px-2.5 rounded-lg border border-indigo-100">
              {activeTab === 'prospect' ? 'Business Scout' : activeTab === 'pipeline' ? 'Prospect Pipeline' : 'Outreach Workbench'}
            </span>
            <h1 className="text-base font-semibold text-slate-800 md:text-lg">Teixido Local Business OS</h1>
          </div>
          
          <div className="flex items-center gap-2.5">
            {authError && <span role="alert" className="text-xs text-rose-600">{authError}</span>}
            <button
              type="button"
              onClick={() => void handleSignOut()}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-50"
            >
              Sign out
            </button>
            <button
              type="button"
              id="connect-gmail-btn"
              onClick={() => { window.location.href = '/api/auth/google'; }}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition flex items-center gap-1.5 cursor-pointer border ${
                gmailConnected
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                  : 'bg-indigo-600 text-white border-indigo-600 hover:bg-indigo-700'
              }`}
              title={gmailConnected ? `Gmail connected${gmailEmail ? ` as ${gmailEmail}` : ''}` : 'Connect Gmail to send reviewed outreach emails'}
            >
              <Mail className="h-3.5 w-3.5" />
              <span>{gmailConnected ? (gmailEmail ? `Gmail: ${gmailEmail}` : 'Gmail Connected') : 'Connect Gmail'}</span>
            </button>
            <button
              type="button"
              id="export-pipeline-json-btn"
              onClick={handleExportJSON}
              className="px-3.5 py-1.5 border border-slate-200 rounded-lg text-xs font-semibold text-slate-600 hover:bg-slate-50 transition flex items-center gap-1.5 cursor-pointer"
              title="Export leads pipeline onto your local machine in JSON format"
            >
              <FileJson className="h-3.5 w-3.5 text-indigo-500" />
              <span className="hidden sm:inline">Export JSON</span>
            </button>
            <button
              type="button"
              id="clear-pipeline-btn"
              onClick={clearPipeline}
              className="px-3.5 py-1.5 bg-slate-100 text-slate-600 rounded-lg text-xs font-semibold hover:bg-slate-200 hover:text-slate-800 transition flex items-center gap-1.5 cursor-pointer"
              title="Reset the pipeline database"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Clear Prospect Cache</span>
            </button>
          </div>
        </header>

        {/* CONTENT ENVELOPE AREA */}
        <div className="flex-1 overflow-y-auto p-6 md:p-8 space-y-6">

          {/* INTERACTIVE COMPONENT ROW FOR ACTIVE PLANNERS */}
          {selectedLeadForStrategy && (
            <div className="animate-in fade-in slide-in-from-top duration-300">
              <PitchStrategyView 
                lead={selectedLeadForStrategy} 
                onClose={() => setSelectedLeadForStrategy(null)} 
                profile={profile}
              />
            </div>
          )}

          {selectedLeadForCustomizer && (
            <div className="animate-in fade-in slide-in-from-top duration-300">
              <OutreachCustomizer 
                lead={selectedLeadForCustomizer} 
                onUpdateTemplate={handleUpdateTemplate}
                onClose={() => setSelectedLeadForCustomizer(null)} 
                profile={profile}
              />
            </div>
          )}

          {/* STATS STRIP VIEW */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 select-none">
            <div className="bg-white p-4 rounded-xl border border-slate-100 shadow-sm flex flex-col justify-between">
              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-indigo-500" /> Active Prospects
                </p>
                <h3 className="text-2xl font-bold tracking-tight text-slate-800 mt-1">{totalLeadsCount}</h3>
              </div>
              <p className="text-[10px] text-slate-400 mt-2">Leads tracked in CRM storage</p>
            </div>

            <div className="bg-white p-4 rounded-xl border border-slate-100 shadow-sm flex flex-col justify-between">
              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> High-Match Targets
                </p>
                <h3 className="text-2xl font-bold tracking-tight text-slate-800 mt-1">{inDiscussionCount}</h3>
              </div>
              <p className="text-[10px] text-emerald-600 mt-2 font-medium">Warm interactions ongoing</p>
            </div>

            <div className="bg-white p-4 rounded-xl border border-slate-100 shadow-sm flex flex-col justify-between">
              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500" /> Tech Needs Gaps
                </p>
                <h3 className="text-2xl font-bold tracking-tight text-slate-800 mt-1">{totalNeedsCount}</h3>
              </div>
              <p className="text-[10px] text-slate-400 mt-2">Identified code opportunities</p>
            </div>

            <div className="bg-white p-4 rounded-xl border border-slate-100 shadow-sm flex flex-col justify-between">
              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-indigo-600 animate-pulse" /> Market Engagement
                </p>
                <h3 className="text-2xl font-bold tracking-tight text-indigo-600 mt-1">High Intensity</h3>
              </div>
              <p className="text-[10px] text-slate-450 mt-2">Strong software contractor demand</p>
            </div>
          </div>

          {/* VIEW TAB 1: PROSPECT SEARCH ENGINE */}
          {activeTab === 'prospect' && (
            <div className="space-y-6">

              <div className="bg-indigo-50 border border-indigo-100 rounded-2xl p-5 flex flex-col sm:flex-row items-start gap-4">
                <div className="p-2.5 bg-indigo-100 rounded-xl text-indigo-700">
                  <Sparkles className="h-6 w-6 animate-spin" style={{ animationDuration: '6s' }} />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-indigo-900">How Grounded Lead Searching Works</h3>
                  <p className="text-xs text-indigo-750 mt-1 leading-relaxed">
                    This system queries live DuckDuckGo corporate databases and local commerce results in your specified sector using Web Search grouping. Then, it attempts to crawl the retrieved domains to locate actual, real email addresses from their contact pages, enabling you to build fully verified B2B targets without needing expensive API integrations.
                  </p>
                </div>
              </div>

              <LeadGeneratorForm onSearch={handleSearchAILeads} isLoading={isLoadingLeads} />
            </div>
          )}

          {/* VIEW TAB 2: CLIENT PIPELINE CRM BOARD */}
          {activeTab === 'pipeline' && (
            <div className="space-y-6">
              
              {/* Controls and refinement search */}
              <div className="bg-white border border-slate-100 p-4 rounded-2xl shadow-sm space-y-4">
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                  
                  {/* Status Filters */}
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider mr-2 flex items-center gap-1">
                      <ListFilter className="h-3.5 w-3.5 text-slate-400" /> Pipeline Filter:
                    </span>
                    <button
                      type="button"
                      id="filter-status-all"
                      onClick={() => setStatusFilter('All')}
                      className={`text-xs px-3 py-1.5 rounded-lg font-medium border transition cursor-pointer ${
                        statusFilter === 'All'
                          ? 'bg-slate-900 border-slate-950 text-white font-bold'
                          : 'bg-slate-50 border-slate-100 text-slate-600 hover:bg-slate-100'
                      }`}
                    >
                      All ({leads.length})
                    </button>
                    {(['Lead', 'Contacted', 'In Discussion', 'Replied'] as const).map((status) => (
                      <button
                        key={status}
                        type="button"
                        id={`filter-status-${status.replace(/\s+/g, '-').toLowerCase()}`}
                        onClick={() => setStatusFilter(status)}
                        className={`text-xs px-3 py-1.5 rounded-lg font-medium border transition cursor-pointer ${
                          statusFilter === status
                            ? 'bg-slate-900 border-slate-950 text-white font-bold'
                            : 'bg-slate-50 border-slate-100 text-slate-600 hover:bg-slate-100'
                        }`}
                      >
                        {status} ({leads.filter(l => l.status === status).length})
                      </button>
                    ))}
                  </div>

                  {/* Manual trigger and text search combo */}
                  <div className="flex w-full md:w-auto items-center gap-2 flex-wrap sm:flex-nowrap">
                    {/* Grid vs Map Toggle */}
                    <div className="flex bg-slate-100 p-1 rounded-lg border border-slate-200 shrink-0">
                      <button
                        type="button"
                        id="view-toggle-grid-btn"
                        onClick={() => setPipelineView('grid')}
                        className={`px-2.5 py-1 text-[11px] rounded font-semibold transition cursor-pointer select-none ${
                          pipelineView === 'grid'
                            ? 'bg-white text-slate-800 shadow-xs'
                            : 'text-slate-500 hover:text-slate-800'
                        }`}
                      >
                        Grid
                      </button>
                      <button
                        type="button"
                        id="view-toggle-map-btn"
                        onClick={() => setPipelineView('map')}
                        className={`px-2.5 py-1 text-[11px] rounded font-semibold transition flex items-center gap-1 cursor-pointer select-none ${
                          pipelineView === 'map'
                            ? 'bg-white text-indigo-700 shadow-xs'
                            : 'text-slate-500 hover:text-indigo-600'
                        }`}
                      >
                        <MapPin className="h-3 w-3" />
                        <span>Map</span>
                      </button>
                    </div>

                    <input
                      type="text"
                      id="pipeline-text-search-input"
                      value={searchFilter}
                      onChange={(e) => setSearchFilter(e.target.value)}
                      placeholder="Filter by name, state, tech..."
                      className="w-full md:w-48 px-3.5 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg outline-none focus:ring-1 focus:ring-indigo-500"
                    />
                    <button
                      type="button"
                      id="trigger-add-manual-lead-btn"
                      onClick={() => setShowManualAdd(!showManualAdd)}
                      className="px-3.5 py-1.5 bg-indigo-600 text-white rounded-lg text-xs font-bold hover:bg-indigo-700 transition flex items-center gap-1 cursor-pointer select-none shrink-0"
                    >
                      {showManualAdd ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
                      <span>{showManualAdd ? 'Cancel Form' : 'Add Client'}</span>
                    </button>
                  </div>

                </div>

                {/* Grounding Sources Info if present from last AI generation */}
                {groundingSources.length > 0 && (
                  <div className="border-t border-slate-100 pt-3 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                    <span className="font-bold text-slate-400 flex items-center gap-1">
                      <Sparkles className="h-3 w-3 text-emerald-500" /> Research Grounding:
                    </span>
                    {groundingSources.map((src, sIdx) => (
                      <a
                        key={sIdx}
                        href={src.uri}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-100/50 px-2 py-0.5 rounded inline-flex items-center gap-0.5 font-medium transition cursor-pointer"
                        title={src.title}
                      >
                        <Globe className="h-2.5 w-2.5" />
                        <span className="max-w-[150px] truncate">{src.title}</span>
                      </a>
                    ))}
                  </div>
                )}
              </div>

              {/* MANUAL LEAD QUICK ADD DIALOG FORM */}
              {showManualAdd && (
                <div className="bg-white border border-indigo-100 rounded-2xl p-5 shadow-sm space-y-4 animate-in fade-in slide-in-from-top duration-200">
                  <div className="flex items-center gap-2 border-b border-indigo-50 pb-2">
                    <Building2 className="h-4 w-4 text-indigo-600" />
                    <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">Log Manual Client Lead</h3>
                  </div>

                  <form id="manual-lead-add-form" onSubmit={handleManualAddSubmit} className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-500 mb-1">Company Name *</label>
                        <input
                          type="text"
                          required
                          placeholder="e.g. Acme Tech Solutions"
                          value={manualName}
                          onChange={(e) => setManualName(e.target.value)}
                          className="w-full p-2 text-xs bg-slate-50 border border-slate-200 rounded focus:ring-1 focus:ring-indigo-500 outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-500 mb-1">Website URL</label>
                        <input
                          type="text"
                          placeholder="e.g. acmetech.com"
                          value={manualWebsite}
                          onChange={(e) => setManualWebsite(e.target.value)}
                          className="w-full p-2 text-xs bg-slate-50 border border-slate-200 rounded focus:ring-1 focus:ring-indigo-500 outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-500 mb-1">Location</label>
                        <input
                          type="text"
                          placeholder="e.g. Denver, CO"
                          value={manualLocation}
                          onChange={(e) => setManualLocation(e.target.value)}
                          className="w-full p-2 text-xs bg-slate-50 border border-slate-200 rounded focus:ring-1 focus:ring-indigo-500 outline-none"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-500 mb-1">Industry Sector</label>
                        <input
                          type="text"
                          placeholder="e.g. Food Tech, Health Tech"
                          value={manualIndustry}
                          onChange={(e) => setManualIndustry(e.target.value)}
                          className="w-full p-2 text-xs bg-slate-50 border border-slate-200 rounded focus:ring-1 focus:ring-indigo-500 outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-500 mb-1">Contact Email *</label>
                        <input
                          type="email"
                          required
                          placeholder="e.g. tech@acmetech.com"
                          value={manualEmail}
                          onChange={(e) => setManualEmail(e.target.value)}
                          className="w-full p-2 text-xs bg-slate-50 border border-slate-200 rounded focus:ring-1 focus:ring-indigo-500 outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-500 mb-1">Contact Person Title</label>
                        <input
                          type="text"
                          placeholder="e.g. IT Director, Store Manager"
                          value={manualPerson}
                          onChange={(e) => setManualPerson(e.target.value)}
                          className="w-full p-2 text-xs bg-slate-50 border border-slate-200 rounded focus:ring-1 focus:ring-indigo-500 outline-none"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-slate-500 mb-1">General Description</label>
                      <textarea
                        placeholder="What do they do?"
                        value={manualDesc}
                        onChange={(e) => setManualDesc(e.target.value)}
                        rows={2}
                        className="w-full p-2 text-xs bg-slate-50 border border-slate-200 rounded focus:ring-1 focus:ring-indigo-500 outline-none resize-none"
                      />
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-500 mb-1">Needs / Gaps (Comma separated)</label>
                        <input
                          type="text"
                          placeholder="Legacy codebase migration, Stripe subscriptions integration"
                          value={manualNeeds}
                          onChange={(e) => setManualNeeds(e.target.value)}
                          className="w-full p-2 text-xs bg-slate-50 border border-slate-200 rounded focus:ring-1 focus:ring-indigo-500 outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-500 mb-1">Suggested Tech Stack (Comma separated)</label>
                        <input
                          type="text"
                          placeholder="Next.js, NextAuth, Stripe"
                          value={manualStack}
                          onChange={(e) => setManualStack(e.target.value)}
                          className="w-full p-2 text-xs bg-slate-50 border border-slate-200 rounded focus:ring-1 focus:ring-indigo-500 outline-none"
                        />
                      </div>
                    </div>

                    <div className="flex justify-end gap-2 pt-2">
                      <button
                        type="button"
                        onClick={() => setShowManualAdd(false)}
                        className="px-3.5 py-1.5 border border-slate-200 text-slate-500 rounded text-xs font-semibold hover:bg-slate-50 ml-auto cursor-pointer"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        id="save-manual-lead-btn"
                        className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded text-xs font-semibold transition cursor-pointer"
                      >
                        Save Client Lead
                      </button>
                    </div>
                  </form>
                </div>
              )}

              {/* CORE LEADS LIST GRID (OR EMPTY VIEWS OR MAP VIEW) */}
              {pipelineView === 'map' ? (
                <LeadMap
                  leads={filteredLeads}
                  onSelectStrategy={(l) => {
                    setSelectedLeadForStrategy(l);
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                  onCustomizeTemplate={(l) => {
                    setSelectedLeadForCustomizer(l);
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                />
              ) : filteredLeads.length === 0 ? (
                <div className="bg-white border border-slate-100 rounded-2xl p-12 text-center text-slate-500">
                  <Building2 className="h-12 w-12 text-slate-350 mx-auto mb-3" />
                  <h3 className="text-sm font-bold text-slate-700 leading-relaxed uppercase tracking-widest">No matching leads in active pipeline</h3>
                  <p className="text-xs text-slate-400 mt-2 max-w-sm mx-auto">
                    Try adjusting your filter settings above or navigate to the <strong>Search Prospects</strong> tab to map new physical target areas!
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                  {filteredLeads.map((lead) => (
                    <LeadCard
                      key={lead.id}
                      lead={lead}
                      onStatusChange={handleStatusChange}
                      onNotesChange={handleNotesChange}
                      onSelectStrategy={(l) => {
                        setSelectedLeadForStrategy(l);
                        window.scrollTo({ top: 0, behavior: 'smooth' });
                      }}
                      onCustomizeTemplate={(l) => {
                        setSelectedLeadForCustomizer(l);
                        window.scrollTo({ top: 0, behavior: 'smooth' });
                      }}
                      onDelete={handleDeleteLead}
                      profile={profile}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* VIEW TAB 3: OUTREACH CAMPAIGNS & DIGITAL TEMPLATES */}
          {activeTab === 'outreach' && (
            <div className="space-y-6">
              <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden shadow-sm">
                <table className="w-full text-left font-sans">
                  <thead className="bg-slate-950 border-b border-slate-900 text-[10px] font-bold text-slate-100 uppercase tracking-widest">
                    <tr>
                      <th className="px-6 py-4">Client Name & Status</th>
                      <th className="px-6 py-4">Target Person</th>
                      <th className="px-6 py-4">Outreach Draft Pitch</th>
                      <th className="px-6 py-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {leads.map((lead) => (
                      <tr key={lead.id} className="hover:bg-indigo-50/20 transition-colors">
                        <td className="px-6 py-4">
                          <div className="font-bold text-slate-800 flex items-center gap-1.5 flex-wrap">
                            {lead.name}
                            <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold border ${
                              lead.status === 'Replied'
                                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                : lead.status === 'Contacted'
                                ? 'bg-amber-50 text-amber-700 border-amber-200'
                                : lead.status === 'In Discussion'
                                ? 'bg-indigo-50 text-indigo-750 border-indigo-200'
                                : 'bg-slate-50 text-slate-600 border-slate-200'
                            }`}>
                              {lead.status}
                            </span>
                          </div>
                          <div className="text-[10px] text-slate-400 mt-1">{lead.location}</div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="text-xs font-semibold text-slate-700">{lead.contactPerson || 'Decision Maker'}</div>
                          <div className="text-[10.5px] font-mono text-indigo-600 font-medium">{lead.contactEmail}</div>
                        </td>
                        <td className="px-6 py-4 max-w-xs">
                          <p className="text-xs text-slate-500 truncate leading-relaxed">
                            {lead.outreachTemplate
                              .replaceAll('[My Name]', profile.fullName)
                              .replaceAll('[Your Name]', profile.fullName)
                              .replace(/Subject:\s+.*|Hi\s+\w+,/g, '')
                              .trim()}
                          </p>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <div className="flex justify-end gap-1.5 whitespace-nowrap">
                            <button
                              type="button"
                              id={`outreach-edit-btn-${lead.id}`}
                              onClick={() => {
                                setSelectedLeadForCustomizer(lead);
                                window.scrollTo({ top: 0, behavior: 'smooth' });
                              }}
                              className="text-xs text-indigo-600 hover:text-indigo-800 font-bold bg-indigo-50 hover:bg-indigo-100 px-3 py-1.5 rounded-lg transition shrink-0 cursor-pointer"
                            >
                              Edit Template
                            </button>
                            <button
                              type="button"
                              id={`outreach-copy-quick-${lead.id}`}
                              onClick={() => {
                                const customized = lead.outreachTemplate
                                  .replaceAll('[My Name]', profile.fullName)
                                  .replaceAll('[Your Name]', profile.fullName);
                                navigator.clipboard.writeText(customized);
                                setCopiedLeadId(lead.id);
                                setTimeout(() => setCopiedLeadId(null), 2000);
                              }}
                              className="bg-slate-100 text-slate-600 hover:text-slate-900 border border-slate-200 hover:bg-slate-200 p-1.5 rounded-lg transition shrink-0 flex items-center justify-center cursor-pointer min-w-8"
                              title="Quick Copy Pitch"
                            >
                              {copiedLeadId === lead.id ? (
                                <Check className="h-3.5 w-3.5 text-emerald-600" />
                              ) : (
                                <Copy className="h-3.5 w-3.5" />
                              )}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* CRM ADVICE CONTAINER */}
              <div className="bg-slate-50 border border-slate-200/60 rounded-2xl p-6 flex flex-col md:flex-row items-start gap-4 select-none">
                <div className="p-3 bg-white border border-slate-200 rounded-xl text-slate-600 shrink-0">
                  <Sliders className="h-6 w-6 text-indigo-600" />
                </div>
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-widest text-slate-800">Effective outreach compliance tips:</h3>
                  <ul className="space-y-1.5 mt-3 text-xs text-slate-600 leading-relaxed list-disc pl-4">
                    <li>We have automatically initialized and formatted the generic bracketed signatures with your custom profile: <strong className="text-slate-800">{profile.fullName} ({profile.title})</strong>.</li>
                    <li>Avoid sending automated mass spam. Customize your copies based on the <strong>Consult Strategy</strong> planner inside each client card.</li>
                    <li>Update your lead statuses immediately to 'Contacted' when an email is deployed to retain complete control over your outreach analytics pipelines.</li>
                  </ul>
                </div>
              </div>
            </div>
          )}


          {/* PAGE FOOTER STATS */}
          <footer className="flex items-center justify-between text-[11px] text-slate-400 font-medium pt-4 select-none border-t border-slate-100">
            <p>Research evidence and outreach drafts are prepared for your review.</p>
            <p>{dbConnected ? "Persistent database connected" : "Browser cache mode"}</p>
          </footer>

        </div>
      </main>
    </div>
  );
}
