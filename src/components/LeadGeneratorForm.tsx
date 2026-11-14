import React, { useState } from 'react';
import { SearchQuery } from '../types';
import { Search, Loader2, MapPin, Briefcase, Sliders } from 'lucide-react';

interface Props {
  onSearch: (query: SearchQuery) => void;
  isLoading: boolean;
}

export default function LeadGeneratorForm({ onSearch, isLoading }: Props) {
  const [industry, setIndustry] = useState('Local service businesses with outdated websites, weak booking flows, or manual admin');
  const [location, setLocation] = useState('Tampa Bay, FL');
  const [companyScale, setCompanyScale] = useState('local businesses');
  const [techFocusText, setTechFocusText] = useState('website modernization, online booking, lead capture, workflow automation, AI assistants');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!industry || !location) return;
    const techFocus = techFocusText
      .split(',')
      .map(t => t.trim())
      .filter(Boolean);
    onSearch({
      industry,
      location,
      companyScale,
      techFocus,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="bg-white border text-left border-slate-100 rounded-2xl shadow-sm overflow-hidden">
      <div className="p-5 border-b border-slate-100 flex items-center justify-between">
        <div><h2 className="text-sm font-bold text-slate-800">Business Scout</h2><p className="text-xs text-slate-500 mt-1">Owner profile and service positioning are preconfigured. Review targets, then run a live prospect scan.</p></div>
      </div>
      <div className="p-5 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
              <Briefcase className="h-3.5 w-3.5 text-indigo-500" />
              Industry / Niche
            </label>
            <input
              type="text"
              required
              placeholder="Preconfigured for local service businesses"
              value={industry}
              onChange={(e) => setIndustry(e.target.value)}
              className="w-full text-sm bg-slate-50 border border-slate-200 rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5 text-indigo-500" />
              Location Area
            </label>
            <input
              type="text"
              required
              placeholder="Tampa Bay, FL"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              className="w-full text-sm bg-slate-50 border border-slate-200 rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
              <Briefcase className="h-3.5 w-3.5 text-indigo-500" />
              Company Scale Focus
            </label>
            <select
              value={companyScale}
              onChange={(e) => setCompanyScale(e.target.value)}
              className="w-full text-sm bg-slate-50 border border-slate-200 rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="any">Any Scale</option>
              <option value="startups">Startups</option>
              <option value="local businesses">Local Businesses</option>
              <option value="mid-market">Mid-Market</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
              <Sliders className="h-3.5 w-3.5 text-indigo-500" />
              Target Tech Focus (Comma separated)
            </label>
            <input
              type="text"
              placeholder="e.g., Rust, WASM, TypeScript"
              value={techFocusText}
              onChange={(e) => setTechFocusText(e.target.value)}
              className="w-full text-sm bg-slate-50 border border-slate-200 rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
        </div>
      </div>
      <div className="p-4 bg-slate-50 border-t border-slate-100 flex justify-end">
        <button
          type="submit"
          disabled={isLoading || !industry || !location}
          className="bg-indigo-600 hover:bg-indigo-700 text-white font-medium text-sm py-2 px-5 rounded-lg transition-colors flex items-center gap-2 disabled:opacity-70"
        >
          {isLoading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Scraping Domains...
            </>
          ) : (
            <>
              <Search className="w-4 h-4" />
              Find Real Prospects
            </>
          )}
        </button>
      </div>
    </form>
  );
}
