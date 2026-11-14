import React, { useState, useEffect } from 'react';
import { User, ShieldCheck, Mail, Briefcase, Link2, DollarSign, Sparkles, Check, Edit2, Save, Send, AlertCircle, LogOut } from 'lucide-react';
import { UserProfile } from '../types';
import * as api from '../lib/api';

interface ProfileSettingsProps {
  profile: UserProfile;
  onSaveProfile: (profile: UserProfile) => void;
}

export default function ProfileSettings({ profile, onSaveProfile }: ProfileSettingsProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [fullName, setFullName] = useState(profile.fullName);
  const [title, setTitle] = useState(profile.title);
  const [email, setEmail] = useState(profile.email);
  const [portfolioUrl, setPortfolioUrl] = useState(profile.portfolioUrl);
  const [specialtiesText, setSpecialtiesText] = useState(profile.specialties.join(', '));
  const [customRate, setCustomRate] = useState(profile.customRate);
  const [physicalAddress, setPhysicalAddress] = useState(profile.physicalAddress ?? '');
  const [showStatus, setShowStatus] = useState(false);

  const [gmailStatus, setGmailStatus] = useState<api.GmailStatus | null>(null);
  const [gmailLoading, setGmailLoading] = useState(false);

  useEffect(() => {
    setFullName(profile.fullName);
    setTitle(profile.title);
    setEmail(profile.email);
    setPortfolioUrl(profile.portfolioUrl);
    setSpecialtiesText(profile.specialties.join(', '));
    setCustomRate(profile.customRate);
    setPhysicalAddress(profile.physicalAddress ?? '');
  }, [profile]);

  useEffect(() => {
    let mounted = true;
    setGmailLoading(true);
    api.getGmailStatus()
      .then((s) => { if (mounted) setGmailStatus(s); })
      .catch(() => { /* leave null = unknown */ })
      .finally(() => { if (mounted) setGmailLoading(false); });
    return () => { mounted = false; };
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const specialties = specialtiesText
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    onSaveProfile({
      fullName: fullName.trim(),
      title: title.trim(),
      email: email.trim(),
      portfolioUrl: portfolioUrl.trim(),
      specialties,
      customRate: customRate.trim(),
      physicalAddress: physicalAddress.trim(),
    });

    setIsEditing(false);
    setShowStatus(true);
    setTimeout(() => setShowStatus(false), 3000);
  };

  const handleDisconnect = async () => {
    if (!confirm('Disconnect Gmail? You will need to reconnect before sending again.')) return;
    try {
      await api.disconnectGmail();
      setGmailStatus({ connected: false, sentToday: 0, dailyCap: gmailStatus?.dailyCap ?? 80 });
    } catch (e) {
      alert(`Disconnect failed: ${e instanceof Error ? e.message : 'unknown'}`);
    }
  };

  return (
    <div className="space-y-4">
    <div id="gmail-integration-block" className="bg-white border border-slate-100 rounded-2xl p-6 shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-100 pb-4 mb-4">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-emerald-50 border border-emerald-100 flex items-center justify-center text-emerald-600">
            <Send className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-slate-800">Gmail Integration</h2>
            <p className="text-[10px] text-slate-400">Send outreach directly from your Gmail. Encrypted refresh token, CAN-SPAM footer, 80/day soft cap.</p>
          </div>
        </div>
        {gmailStatus?.connected ? (
          <button
            type="button"
            onClick={handleDisconnect}
            className="px-3 py-1.5 border border-rose-200 text-rose-600 rounded-lg text-xs font-semibold hover:bg-rose-50 inline-flex items-center gap-1"
          >
            <LogOut className="h-3 w-3" />
            <span>Disconnect</span>
          </button>
        ) : null}
      </div>
      {gmailLoading ? (
        <div className="text-xs text-slate-400 italic">Loading Gmail status…</div>
      ) : gmailStatus?.connected ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
          <div>
            <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest">Connected as</span>
            <span className="text-slate-800 font-mono font-medium mt-0.5 block">{gmailStatus.email}</span>
          </div>
          <div>
            <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest">Sends today</span>
            <span className="text-emerald-700 font-bold text-sm mt-0.5 block">{gmailStatus.sentToday} / {gmailStatus.dailyCap}</span>
          </div>
          <div>
            <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest">Connected</span>
            <span className="text-slate-600 mt-0.5 block">{gmailStatus.connectedAt ? new Date(gmailStatus.connectedAt).toLocaleDateString() : '—'}</span>
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-3 flex-wrap">
          <a
            href={api.getGmailConnectUrl()}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold inline-flex items-center gap-1.5 shadow-sm"
          >
            <Send className="h-3.5 w-3.5" />
            <span>Connect Gmail</span>
          </a>
          <div className="text-[11px] text-slate-500 max-w-md flex items-start gap-1.5">
            <AlertCircle className="h-3.5 w-3.5 text-amber-500 mt-0.5 shrink-0" />
            <span>
              {profile.physicalAddress
                ? 'Requires Google OAuth setup in Vercel/.env (GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, GMAIL_TOKEN_ENCRYPTION_KEY).'
                : 'Add a physical address below first — CAN-SPAM requires one in every outreach email.'}
            </span>
          </div>
        </div>
      )}
    </div>

    <div id="freelancer-profile-block" className="bg-white border border-slate-100 rounded-2xl p-6 shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-100 pb-4 mb-4">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600">
            <User className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-slate-800">Teixido Labs Business Identity</h2>
            <p className="text-[10px] text-slate-400">Controls the sender identity and services used in prospect outreach</p>
          </div>
        </div>

        {!isEditing ? (
          <button
            type="button"
            id="edit-profile-btn"
            onClick={() => setIsEditing(true)}
            className="px-3 py-1.5 border border-slate-205 rounded-lg text-xs font-semibold text-slate-600 hover:bg-slate-50 transition flex items-center gap-1 cursor-pointer"
          >
            <Edit2 className="h-3 w-3" />
            <span>Edit Setup</span>
          </button>
        ) : (
          <div className="text-[10px] text-slate-400 font-mono italic animate-pulse">
            Editing Profile...
          </div>
        )}
      </div>

      {showStatus && (
        <div className="mb-4 p-2.5 bg-emerald-50 border border-emerald-100 text-emerald-800 rounded-xl text-xs flex items-center gap-1.5 animate-in fade-in duration-350">
          <Check className="h-4 w-4 text-emerald-600" />
          <span className="font-medium">Business outreach settings saved. New drafts will use this positioning.</span>
        </div>
      )}

      {!isEditing ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-xs">
          {/* Main Info */}
          <div className="space-y-3 md:border-r border-slate-100/80 pr-4">
            <div>
              <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest">Sender Name</span>
              <span className="font-semibold text-slate-800 text-sm mt-0.5 block">{profile.fullName || 'Not Added'}</span>
            </div>
            <div>
              <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest">Role at Teixido Labs</span>
              <span className="text-slate-600 font-medium mt-0.5 block">{profile.title || 'Freelance Custom Software Engineering'}</span>
            </div>
          </div>

          {/* Contact & Links */}
          <div className="space-y-3 md:border-r border-slate-100/80 pr-4">
            <div>
              <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest">Business Contact Email</span>
              <span className="text-indigo-600 font-mono font-medium mt-0.5 block">{profile.email || 'None'}</span>
            </div>
            <div>
              <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest">Portfolio / Pitch URL</span>
              <span className="text-slate-600 truncate mt-0.5 block font-mono hover:text-indigo-600 transition">
                {profile.portfolioUrl ? (
                  <a href={profile.portfolioUrl.startsWith('http') ? profile.portfolioUrl : `https://${profile.portfolioUrl}`} target="_blank" rel="noreferrer" className="underline">
                    {profile.portfolioUrl}
                  </a>
                ) : (
                  'No portfolio linked'
                )}
              </span>
            </div>
          </div>

          {/* Pricing & Stack */}
          <div className="space-y-3 flex flex-col justify-between">
            <div>
              <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest">Service Offer / Positioning</span>
              <span className="text-emerald-700 font-bold text-sm mt-0.5 block">{profile.customRate || '$100/hr'}</span>
            </div>
            <div>
              <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest">Services & Capabilities</span>
              <div className="flex flex-wrap gap-1 mt-1">
                {profile.specialties.map((spec) => (
                  <span key={spec} className="bg-slate-50 text-slate-600 text-[9px] px-1.5 py-0.5 rounded font-mono border border-slate-100">
                    {spec}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} id="profile-edit-form" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">Sender Name *</label>
              <div className="relative">
                <input
                  type="text"
                  required
                  placeholder="Your name"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="w-full p-2 pl-3 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:ring-1 focus:ring-indigo-500 outline-none font-medium"
                />
              </div>
            </div>

            <div>
              <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">Role at Teixido Labs *</label>
              <input
                type="text"
                required
                placeholder="e.g. Custom Web App & AI Solution Architect"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full p-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:ring-1 focus:ring-indigo-500 outline-none"
              />
            </div>

            <div>
              <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">Business Contact Email *</label>
              <input
                type="email"
                required
                placeholder="e.g. hello@yourdomain.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full p-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:ring-1 focus:ring-indigo-500 outline-none font-mono"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">Portfolio or GitHub URL</label>
              <input
                type="text"
                placeholder="e.g. github.com/my-portfolio"
                value={portfolioUrl}
                onChange={(e) => setPortfolioUrl(e.target.value)}
                className="w-full p-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:ring-1 focus:ring-indigo-500 outline-none font-mono"
              />
            </div>

            <div>
              <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">Service Offer / Positioning</label>
              <input
                type="text"
                placeholder="e.g. $125/hr or Fixed Packages Available"
                value={customRate}
                onChange={(e) => setCustomRate(e.target.value)}
                className="w-full p-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:ring-1 focus:ring-indigo-500 outline-none font-medium"
              />
            </div>

            <div>
              <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">Services & Capabilities (comma-separated)</label>
              <input
                type="text"
                placeholder="React, TypeScript, AWS, Python, Stripe"
                value={specialtiesText}
                onChange={(e) => setSpecialtiesText(e.target.value)}
                className="w-full p-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:ring-1 focus:ring-indigo-500 outline-none"
              />
            </div>
          </div>

          <div>
            <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">
              Physical Address (required for CAN-SPAM in every outreach email)
            </label>
            <input
              type="text"
              placeholder="e.g. 123 Main St, Suite 100, Portland OR 97201 (PO box is fine)"
              value={physicalAddress}
              onChange={(e) => setPhysicalAddress(e.target.value)}
              className="w-full p-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:ring-1 focus:ring-indigo-500 outline-none"
            />
            <p className="text-[10px] text-slate-400 mt-1">Will be appended in the email footer alongside the opt-out instruction.</p>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setIsEditing(false)}
              className="px-3.5 py-1.5 border border-slate-200 text-slate-400 rounded text-xs hover:bg-slate-50 cursor-pointer font-medium"
            >
              Cancel
            </button>
            <button
              type="submit"
              id="save-profile-btn"
              className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold transition flex items-center gap-1 cursor-pointer shadow-indigo-100 shadow-sm"
            >
              <Save className="h-3 w-3" />
              <span>Save Business Setup</span>
            </button>
          </div>
        </form>
      )}
    </div>
    </div>
  );
}
