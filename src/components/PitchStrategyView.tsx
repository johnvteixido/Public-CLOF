import React, { useState } from 'react';
import { BookOpen, Sparkles, AlertCircle, Copy, Check, Terminal, Play, Smile } from 'lucide-react';
import { ClientLead, UserProfile } from '../types';
import * as api from '../lib/api';

interface PitchStrategyViewProps {
  lead: ClientLead;
  onClose: () => void;
  profile: UserProfile;
}

export default function PitchStrategyView({ lead, onClose, profile }: PitchStrategyViewProps) {
  const [developerBio, setDeveloperBio] = useState(() => {
    return `${profile.title} experienced in ${profile.specialties.join(', ')}. Offers consulting solutions at ${profile.customRate}. Portfolio URL: ${profile.portfolioUrl || 'N/A'}`;
  });
  const [isLoading, setIsLoading] = useState(false);
  const [strategyMarkdown, setStrategyMarkdown] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const fetchStrategy = async () => {
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const data = await api.postJson<{ strategy: string }>('/generate-pitch-strategy', {
        companyName: lead.name,
        needs: lead.potentialNeeds,
        suggestedStack: lead.suggestedStack,
        customExperience: developerBio,
      });
      setStrategyMarkdown(data.strategy);
    } catch (err: any) {
      console.error(err);
      setErrorMsg(err.message || 'Error formulating developer pitch strategy.');
    } finally {
      setIsLoading(false);
    }
  };

  const copyStrategy = () => {
    if (strategyMarkdown) {
      navigator.clipboard.writeText(strategyMarkdown);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div id="pitch-strategy-panel" className="bg-slate-900 text-slate-100 rounded-2xl border border-slate-800 p-6 shadow-xl space-y-6">
      {/* Title */}
      <div className="flex justify-between items-start gap-4">
        <div className="flex items-center gap-2">
          <div className="bg-indigo-950 text-indigo-400 p-2 rounded-xl border border-indigo-900">
            <BookOpen className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-slate-100">Consultative Pitch Planner</h2>
            <p className="text-xs text-slate-400">Tailor a conversational strategy to win over <span className="text-indigo-400 font-semibold">{lead.name}</span></p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-slate-400 hover:text-white text-xs px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 transition"
        >
          Back to Leads
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Left Column: Input developer details */}
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-slate-800/50 p-4 rounded-xl border border-slate-800">
            <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-2 flex items-center gap-1.5 font-mono">
              <Terminal className="h-3.5 w-3.5 text-indigo-400" /> Developer Expertise
            </h3>
            <p className="text-xs text-slate-400 mb-3 leading-normal">
              State your active technical stack or background. The system will synthesize a customized pitch demonstrating how your background fits their exact business modernization gaps.
            </p>
            <textarea
              id="dev-bio-textarea"
              value={developerBio}
              onChange={(e) => setDeveloperBio(e.target.value)}
              rows={4}
              placeholder="e.g. 2 years React Native / mobile development, built 3 ecommerce storefronts, or software engineering student skilled in Next.js"
              className="w-full text-xs p-3 bg-slate-950 border border-slate-700 rounded-lg text-slate-200 focus:ring-1 focus:ring-indigo-500 outline-none resize-none leading-relaxed"
            />
          </div>

          <div className="bg-slate-800/30 p-4 rounded-xl border border-slate-800/50">
            <h4 className="text-xs font-bold text-slate-350 mb-1 font-mono uppercase">Target Client Stack</h4>
            <div className="flex flex-wrap gap-1.5 mt-2">
              {lead.suggestedStack.map((tech) => (
                <span key={tech} className="bg-slate-900 border border-slate-800 text-indigo-300 px-2 py-0.5 text-[10px] rounded font-mono">
                  {tech}
                </span>
              ))}
            </div>
            
            <h4 className="text-xs font-bold text-slate-350 mt-4 mb-1 font-mono uppercase">Target Need</h4>
            <div className="text-xs text-indigo-200 mt-2 italic border-l-2 border-indigo-500 pl-2 leading-relaxed">
              "{lead.potentialNeeds[0]}"
            </div>
          </div>

          <button
            type="button"
            id="calculate-strategy-btn"
            onClick={fetchStrategy}
            disabled={isLoading}
            className={`w-full py-2.5 px-4 rounded-xl flex items-center justify-center gap-2 font-medium text-xs transition active:scale-95 cursor-pointer ${
              isLoading
                ? 'bg-slate-800 text-slate-500'
                : 'bg-indigo-600 text-white hover:bg-indigo-700 font-bold shadow-indigo-900/50 shadow-md'
            }`}
          >
            {isLoading ? (
              <>
                <svg className="animate-spin h-3.5 w-3.5 text-indigo-400" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                <span>Analyzing Pitch Angles...</span>
              </>
            ) : (
              <>
                <Sparkles className="h-3.5 w-3.5 text-yellow-300" />
                <span>Formulate Tailored Strategy</span>
              </>
            )}
          </button>
        </div>

        {/* Right Column: Display formulated strategies */}
        <div className="lg:col-span-3 min-h-[300px] bg-slate-950 p-5 rounded-2xl border border-slate-800 flex flex-col">
          {isLoading && (
            <div className="flex-1 flex flex-col justify-center items-center text-slate-400 gap-3">
              <svg className="animate-spin h-10 w-10 text-indigo-500" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              <div className="text-center">
                <p className="text-sm font-semibold text-indigo-300">Evaluating consultative talking-points...</p>
                <p className="text-xs text-slate-500 mt-1">Cross-referencing technology stack with {lead.name}'s commercial needs.</p>
              </div>
            </div>
          )}

          {!isLoading && errorMsg && (
            <div className="flex-1 flex items-center justify-center p-6 bg-rose-950/20 rounded-xl border border-rose-900/40 text-center text-rose-300 text-xs">
              <div className="flex flex-col items-center gap-2">
                <AlertCircle className="h-6 w-6 text-rose-400" />
                <span>{errorMsg}</span>
              </div>
            </div>
          )}

          {!isLoading && !strategyMarkdown && !errorMsg && (
            <div className="flex-1 flex flex-col justify-center items-center text-center p-8 text-slate-500">
              <BookOpen className="h-10 w-10 text-slate-700 mb-3" />
              <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest leading-relaxed">No Strategy Formulated Yet</h4>
              <p className="text-xs text-slate-500 mt-2 max-w-sm">
                Tailor your expertise or customize your developer persona on the left, then click <strong>Formulate Tailored Strategy</strong> below to get real interactive sales guidance!
              </p>
            </div>
          )}

          {!isLoading && strategyMarkdown && (
            <div className="flex-1 flex flex-col justify-between">
              <div className="space-y-4">
                <div className="flex justify-between items-center pb-3 border-b border-slate-800">
                  <div className="flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-emerald-400" />
                    <span className="text-xs font-mono font-semibold uppercase tracking-wider text-slate-400">Winning Strategy Outline</span>
                  </div>
                  <button
                    type="button"
                    onClick={copyStrategy}
                    className="p-1 px-2.5 rounded text-[11px] bg-slate-800 hover:bg-slate-700 transition inline-flex items-center gap-1 cursor-pointer text-slate-300 hover:text-white"
                  >
                    {copied ? (
                      <>
                        <Check className="h-3 w-3 text-emerald-400" />
                        <span>Copied strategy</span>
                      </>
                    ) : (
                      <>
                        <Copy className="h-3 w-3" />
                        <span>Copy Guide</span>
                      </>
                    )}
                  </button>
                </div>

                {/* Render strategy beautifully */}
                <div className="text-xs leading-relaxed text-slate-300 overflow-y-auto max-h-[380px] pr-2 space-y-4 prose prose-invert font-sans">
                  {strategyMarkdown.split('\n\n').map((paragraph, pIdx) => {
                    const isHeader = paragraph.startsWith('#') || paragraph.startsWith('**');
                    if (isHeader) {
                      return (
                        <div key={pIdx} className="text-slate-200 mt-4 first:mt-0">
                          <strong className="text-indigo-400 font-semibold">{paragraph.replace(/^#+\s+|^#+|^\*\*|^\*\*+/g, '').replace(/\*\*$/g, '')}</strong>
                        </div>
                      );
                    }
                    return (
                      <p key={pIdx} className="text-slate-300 font-normal">
                        {paragraph}
                      </p>
                    );
                  })}
                </div>
              </div>

              <div className="mt-4 pt-4 border-t border-slate-800/80 bg-slate-900/50 -mx-5 -mb-5 p-4 rounded-b-2xl flex items-center justify-between text-[11px] text-slate-400">
                <span className="flex items-center gap-1"><Smile className="h-3.5 w-3.5 text-emerald-400" /> Grounded proposal based on customized CRM profile</span>
                <span>Fully persistent offline logs</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
