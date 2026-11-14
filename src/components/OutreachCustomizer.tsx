import React, { useState } from 'react';
import { Mail, Sparkles, Sliders, Check, Copy, Undo2, Save, Terminal, Info } from 'lucide-react';
import { ClientLead, UserProfile } from '../types';
import * as api from '../lib/api';

interface OutreachCustomizerProps {
  lead: ClientLead;
  onUpdateTemplate: (leadId: string, updatedTemplate: string) => void;
  onClose: () => void;
  profile: UserProfile;
}

export default function OutreachCustomizer({ lead, onUpdateTemplate, onClose, profile }: OutreachCustomizerProps) {
  const [tone, setTone] = useState<'professional' | 'warm' | 'direct' | 'creative'>('professional');
  const [customTech, setCustomTech] = useState(lead.suggestedStack.slice(0, 3).join(', '));
  const [templateText, setTemplateText] = useState(() => {
    // Replace standard placeholders initially
    return lead.outreachTemplate
      .replaceAll('[My Name]', profile.fullName)
      .replaceAll('[Your Name]', profile.fullName);
  });
  const [isLoading, setIsLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleRegenerate = async () => {
    setIsLoading(true);
    setSaved(false);
    try {
      const parsedTech = customTech.split(',').map(t => t.trim()).filter(Boolean);
      const data = await api.postJson<{ template?: string }>('/generate-outreach-template', {
        companyName: lead.name,
        companyDescription: lead.description,
        needs: lead.potentialNeeds,
        tone,
        techFocus: parsedTech,
        profile,
      });
      if (data.template) {
        setTemplateText(data.template);
      }
    } catch (error) {
      console.error(error);
      alert('Error regenerating template. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(templateText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSave = () => {
    onUpdateTemplate(lead.id, templateText);
    setSaved(true);
    setTimeout(() => {
      setSaved(false);
      onClose();
    }, 1200);
  };

  return (
    <div id="outreach-customizer-panel" className="bg-white border border-slate-100 rounded-2xl p-6 shadow-sm space-y-6">
      {/* Header */}
      <div className="flex justify-between items-start">
        <div className="flex items-center gap-2">
          <div className="bg-indigo-50 text-indigo-600 p-2 rounded-xl">
            <Mail className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-800">Customize Outreach Campaign</h3>
            <p className="text-[11px] text-slate-400">Generate high-converting personalized pitches for <span className="text-slate-600 font-semibold">{lead.name}</span></p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-xs text-slate-500 hover:text-slate-800 border border-slate-200 px-2.5 py-1.5 rounded-lg hover:bg-slate-50 transition cursor-pointer"
        >
          Back to Leads
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Side: Parameters */}
        <div className="lg:col-span-5 space-y-5">
          {/* Tone Selector */}
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <Sliders className="h-3.5 w-3.5 text-indigo-500" /> Choose Copy-Writing Tone
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                id="tone-pro-btn"
                onClick={() => setTone('professional')}
                className={`py-2 px-3 text-xs font-medium rounded-xl border text-center transitioncursor-pointer ${
                  tone === 'professional'
                    ? 'bg-indigo-50 border-indigo-200 text-indigo-700'
                    : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                💼 Professional
              </button>
              <button
                type="button"
                id="tone-warm-btn"
                onClick={() => setTone('warm')}
                className={`py-2 px-3 text-xs font-medium rounded-xl border text-center transition cursor-pointer ${
                  tone === 'warm'
                    ? 'bg-indigo-50 border-indigo-200 text-indigo-700'
                    : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                🌸 Warm & Friendly
              </button>
              <button
                type="button"
                id="tone-direct-btn"
                onClick={() => setTone('direct')}
                className={`py-2 px-3 text-xs font-medium rounded-xl border text-center transition cursor-pointer ${
                  tone === 'direct'
                    ? 'bg-indigo-50 border-indigo-200 text-indigo-700'
                    : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                ⚡ Ultra-Direct
              </button>
              <button
                type="button"
                id="tone-creative-btn"
                onClick={() => setTone('creative')}
                className={`py-2 px-3 text-xs font-medium rounded-xl border text-center transition cursor-pointer ${
                  tone === 'creative'
                    ? 'bg-indigo-50 border-indigo-200 text-indigo-700'
                    : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                🎨 Creative Pitch
              </button>
            </div>
          </div>

          {/* Highlighted Tech Skills */}
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
              <Terminal className="h-3.5 w-3.5 text-indigo-500" /> Technologies to Highlight
            </label>
            <input
              type="text"
              id="custom-tech-highlight-input"
              value={customTech}
              onChange={(e) => setCustomTech(e.target.value)}
              placeholder="React, TypeScript, AWS, Next.js"
              className="w-full px-3.5 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl leading-normal outline-none focus:ring-1 focus:ring-indigo-500"
            />
            <p className="text-[10px] text-slate-400 mt-1 leading-normal">
              Separate with commas. These tech items will be embedded naturally in your pitch email to validate your engineering capabilities.
            </p>
          </div>

          <button
            type="button"
            id="regenerate-template-btn"
            onClick={handleRegenerate}
            disabled={isLoading}
            className={`w-full py-2.5 px-4 rounded-xl flex items-center justify-center gap-2 font-medium text-xs transition active:scale-95 cursor-pointer ${
              isLoading
                ? 'bg-slate-100 text-slate-450'
                : 'bg-indigo-600 hover:bg-indigo-700 text-white hover:shadow-md'
            }`}
          >
            {isLoading ? (
              <>
                <svg className="animate-spin h-3.5 w-3.5 text-indigo-500" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                <span>Rewriting Outreach Copy...</span>
              </>
            ) : (
              <>
                <Sparkles className="h-3.5 w-3.5 text-indigo-300" />
                <span>Re-generate with AI</span>
              </>
            )}
          </button>
        </div>

        {/* Right Side: Document Editor */}
        <div className="lg:col-span-7 flex flex-col space-y-3 bg-slate-50 border border-slate-100 p-4 rounded-2xl">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-mono uppercase font-bold text-slate-400 flex items-center gap-1">
              <Mail className="h-3 w-3" /> Email Template Draft
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                id="copy-custom-outreach-btn"
                onClick={copyToClipboard}
                className="px-2.5 py-1 rounded bg-white text-[11px] font-medium border border-slate-200 text-slate-600 hover:text-indigo-600 transition inline-flex items-center gap-1 cursor-pointer"
              >
                {copied ? (
                  <>
                    <Check className="h-3 w-3 text-emerald-500" />
                    <span>Copied!</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-3 w-3" />
                    <span>Copy Draft</span>
                  </>
                )}
              </button>
            </div>
          </div>

          <textarea
            id="outreach-template-editor"
            value={templateText}
            onChange={(e) => setTemplateText(e.target.value)}
            rows={12}
            className="w-full text-xs p-4 bg-white border border-slate-200 rounded-xl leading-relaxed outline-none focus:ring-1 focus:ring-indigo-500 text-slate-700 whitespace-pre-wrap font-sans"
          />

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-slate-500 bg-transparent border border-transparent rounded-xl hover:bg-slate-100 transition cursor-pointer hover:text-slate-800"
            >
              Discard Changes
            </button>
            <button
              type="button"
              id="save-outreach-template-btn"
              onClick={handleSave}
              className={`px-4 py-2 text-xs font-semibold rounded-xl flex items-center gap-1.5 transition active:scale-95 cursor-pointer ${
                saved
                  ? 'bg-emerald-600 text-white'
                  : 'bg-indigo-600 hover:bg-indigo-700 text-white'
              }`}
            >
              {saved ? (
                <>
                  <Check className="h-3.5 w-3.5" />
                  <span>Saved Template!</span>
                </>
              ) : (
                <>
                  <Save className="h-3.5 w-3.5" />
                  <span>Save to CRM Lead</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      <div className="bg-blue-50/45 p-3.5 rounded-xl border border-blue-100 flex gap-3 text-xs text-blue-700 leading-relaxed font-sans">
        <Info className="h-4.5 w-4.5 text-blue-500 flex-shrink-0 mt-0.5" />
        <p>
          Saving this template updates this client lead in your dashboard session context. You can export leads to JSON or clipboard at any point using the top toolbar.
        </p>
      </div>
    </div>
  );
}
