import React, { useState, useEffect, useMemo } from 'react';
import { ClientLead } from '../types';
import { MapPin, Globe, Mail, BadgeCheck, Compass } from 'lucide-react';

interface LeadMapProps {
  leads: ClientLead[];
  onSelectStrategy?: (lead: ClientLead) => void;
  onCustomizeTemplate?: (lead: ClientLead) => void;
}

export default function LeadMap({ leads, onSelectStrategy, onCustomizeTemplate }: LeadMapProps) {
  const [selectedLead, setSelectedLead] = useState<ClientLead | null>(null);

  // Filter leads that actually have valid coordinates
  const mapLeads = useMemo(() => {
    return leads.filter(l => typeof l.latitude === 'number' && typeof l.longitude === 'number');
  }, [leads]);

  // Compute dynamic bounding box for leads
  const projectionBounds = useMemo(() => {
    if (mapLeads.length === 0) {
      return { minLat: 24, maxLat: 49, minLng: -125, maxLng: -66 }; // Default US bounds
    }
    const lats = mapLeads.map(l => l.latitude!);
    const lngs = mapLeads.map(l => l.longitude!);

    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);

    const latDiff = Math.max(maxLat - minLat, 5);
    const lngDiff = Math.max(maxLng - minLng, 8);

    return {
      minLat: minLat - latDiff * 0.2,
      maxLat: maxLat + latDiff * 0.2,
      minLng: minLng - lngDiff * 0.2,
      maxLng: maxLng + lngDiff * 0.2,
    };
  }, [mapLeads]);

  // Map coordinates to percentage positions (X: 8-92, Y: 8-92)
  const getRelativePosition = (lat: number, lng: number) => {
    const { minLat, maxLat, minLng, maxLng } = projectionBounds;
    const latSpan = maxLat - minLat || 1;
    const lngSpan = maxLng - minLng || 1;

    const x = ((lng - minLng) / lngSpan) * 100;
    const y = (1 - (lat - minLat) / latSpan) * 100;

    return {
      x: Math.min(Math.max(x, 8), 92),
      y: Math.min(Math.max(y, 8), 92),
    };
  };

  // Auto-select highest-priority lead on mount / leads change
  useEffect(() => {
    if (mapLeads.length > 0 && !selectedLead) {
      const primary = mapLeads.find(l => l.status === 'In Discussion' || l.status === 'Replied') ?? mapLeads[0];
      if (primary) setSelectedLead(primary);
    }
  }, [mapLeads]);

  const getStatusColor = (status: ClientLead['status']) => {
    switch (status) {
      case 'Replied': return 'bg-emerald-500';
      case 'In Discussion': return 'bg-indigo-500';
      case 'Contacted': return 'bg-amber-500';
      default: return 'bg-slate-400';
    }
  };

  return (
    <div id="lead-radar-container" className="bg-slate-950 border border-slate-800 rounded-3xl overflow-hidden shadow-xl flex flex-col md:flex-row h-[550px] relative font-sans text-slate-100">

      {/* Radar Scanning Area */}
      <div className="flex-1 min-h-0 relative select-none bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-slate-900 via-slate-950 to-black flex items-center justify-center p-4">

        {/* Concentric grid */}
        <div className="absolute inset-0 pointer-events-none opacity-20 flex items-center justify-center">
          <div className="border border-indigo-500/40 rounded-full w-[80%] aspect-square absolute"></div>
          <div className="border border-indigo-500/40 rounded-full w-[60%] aspect-square absolute"></div>
          <div className="border border-indigo-500/40 rounded-full w-[40%] aspect-square absolute"></div>
          <div className="border border-indigo-500/40 rounded-full w-[20%] aspect-square absolute"></div>
          <div className="w-[90%] h-px bg-indigo-500/30 absolute"></div>
          <div className="h-[90%] w-px bg-indigo-500/30 absolute"></div>
          <div className="w-[80%] h-px bg-indigo-500/20 rotate-45 absolute"></div>
          <div className="w-[80%] h-px bg-indigo-500/20 -rotate-45 absolute"></div>
        </div>

        {/* Animated sweep */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden rounded-3xl">
          <div className="w-[200%] h-[200%] absolute top-[-50%] left-[-50%] bg-[conic-gradient(from_0deg_at_50%_50%,rgba(99,102,241,0.15)_0deg,transparent_120deg)] animate-spin" style={{ animationDuration: '8s' }}></div>
        </div>

        {/* Interactive Plotting Canvas */}
        <div className="w-full h-full relative z-10">

          {/* Legend */}
          <div className="absolute top-4 left-4 bg-slate-900/80 backdrop-blur-md border border-slate-800/80 px-3 py-2 rounded-xl text-xs space-y-1">
            <span className="font-bold text-slate-200 flex items-center gap-1.5 font-mono uppercase tracking-widest text-[9.5px]">
              <Compass className="h-3.5 w-3.5 text-indigo-400 animate-spin" style={{ animationDuration: '12s' }} />
              Projection Radar
            </span>
            <p className="text-[10px] text-slate-400 font-medium">Coordinate-relative lead scanning grid</p>
          </div>

          {/* Target dots */}
          {mapLeads.map((lead) => {
            const { x, y } = getRelativePosition(lead.latitude!, lead.longitude!);
            const isSelected = selectedLead?.id === lead.id;
            const dotColor = getStatusColor(lead.status);

            return (
              <button
                key={lead.id}
                type="button"
                id={`radar-marker-${lead.id}`}
                onClick={() => setSelectedLead(lead)}
                style={{ left: `${x}%`, top: `${y}%` }}
                className="absolute -translate-x-1/2 -translate-y-1/2 group cursor-pointer transition focus:outline-none"
                title={lead.name}
              >
                <span className={`absolute -inset-2.5 rounded-full opacity-35 animate-ping duration-1000 ${dotColor}`}></span>
                <span className={`w-3.5 h-3.5 rounded-full border border-white block relative shadow-md transition-all ${
                  isSelected ? 'scale-125 ring-2 ring-indigo-400 ring-offset-2 ring-offset-slate-950' : 'hover:scale-110'
                } ${dotColor}`}></span>
              </button>
            );
          })}

          {mapLeads.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center text-center p-6 text-slate-400">
              <div className="space-y-2 max-w-xs">
                <Compass className="h-8 w-8 text-slate-600 mx-auto" />
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Radar Inactive</p>
                <p className="text-[11px] text-slate-500 leading-normal">Generate prospects using the search panel to display them here.</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Selected target inspection sidebar */}
      <div className="w-full md:w-80 bg-slate-900 border-t md:border-t-0 md:border-l border-slate-800 p-5 flex flex-col justify-between shrink-0 overflow-y-auto">
        {selectedLead ? (
          <div className="space-y-4 flex-1 flex flex-col justify-between">
            <div className="space-y-3.5">
              <div className="flex justify-between items-start border-b border-slate-800 pb-3 gap-2">
                <div>
                  <h4 className="font-bold text-slate-100 text-sm leading-snug flex items-center gap-1.5 flex-wrap">
                    {selectedLead.name}
                    {selectedLead.website !== 'N/A' && (
                      <a
                        href={selectedLead.website.startsWith('http') ? selectedLead.website : `https://${selectedLead.website}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-slate-400 hover:text-indigo-400 transition"
                        title="Open corporate domain"
                      >
                        <Globe className="h-3.5 w-3.5" />
                      </a>
                    )}
                  </h4>
                  <p className="text-[10px] text-indigo-400 font-bold font-mono tracking-wider mt-1">{selectedLead.industry}</p>
                </div>
                <span className={`text-[9px] px-2 py-0.5 rounded font-bold uppercase tracking-wider ${
                  selectedLead.status === 'Replied'
                    ? 'bg-emerald-950 text-emerald-400 border border-emerald-900/50'
                    : selectedLead.status === 'In Discussion'
                    ? 'bg-indigo-950 text-indigo-400 border border-indigo-900/50'
                    : 'bg-slate-850 text-slate-400 border border-slate-800'
                }`}>
                  {selectedLead.status}
                </span>
              </div>

              <div className="space-y-1 text-xs">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest font-mono">Location Footprint</span>
                <div className="text-slate-200 flex items-center gap-1">
                  <MapPin className="h-3.5 w-3.5 text-indigo-400" />
                  <span>{selectedLead.location}</span>
                </div>
              </div>

              <div className="space-y-1 text-xs">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest font-mono">Assumed Bottlenecks</span>
                <ul className="space-y-1 bg-slate-950 p-2.5 rounded-xl border border-slate-850">
                  {selectedLead.potentialNeeds.map((need, idx) => (
                    <li key={idx} className="text-[10.5px] text-slate-300 leading-normal flex gap-1.5 items-start">
                      <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 mt-1.5 flex-shrink-0" />
                      <span>{need}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="space-y-1.5 text-xs">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest font-mono">Target stack solutions</span>
                <div className="flex flex-wrap gap-1">
                  {selectedLead.suggestedStack.map((tech) => (
                    <span key={tech} className="bg-slate-950 border border-slate-800 text-indigo-300 font-mono text-[9px] px-2 py-0.5 rounded">
                      {tech}
                    </span>
                  ))}
                </div>
              </div>

              <div className="space-y-1 text-xs">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest font-mono font-medium">Contact Person</span>
                <div className="text-slate-200 font-medium">{selectedLead.contactPerson || 'IT Director / Owner'}</div>
                {selectedLead.contactEmail ? (
                  <a
                    href={`mailto:${selectedLead.contactEmail}`}
                    className="text-indigo-400 hover:underline font-mono text-[10.5px] flex items-center gap-1 mt-1"
                  >
                    <Mail className="h-3 w-3" />
                    <span>{selectedLead.contactEmail}</span>
                    {selectedLead.emailVerified && (
                      <span title="Scraped & verified real email">
                        <BadgeCheck className="h-3 w-3 text-emerald-400" />
                      </span>
                    )}
                  </a>
                ) : (
                  <span className="text-slate-500 text-[10px] flex items-center gap-1 mt-0.5 italic">
                    <Mail className="h-3 w-3" /> Unlisted
                  </span>
                )}
              </div>
            </div>

            <div className="flex gap-2 pt-4 border-t border-slate-850">
              {onCustomizeTemplate && (
                <button
                  type="button"
                  id="radar-side-customize-email-btn"
                  onClick={() => onCustomizeTemplate(selectedLead)}
                  className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2 rounded-xl text-xs text-center transition cursor-pointer"
                >
                  Customize Email
                </button>
              )}
              {onSelectStrategy && (
                <button
                  type="button"
                  id="radar-side-pitch-btn"
                  onClick={() => onSelectStrategy(selectedLead)}
                  className="flex-1 bg-slate-800 hover:bg-slate-750 text-slate-200 border border-slate-700 font-bold py-2 rounded-xl text-xs text-center transition cursor-pointer"
                >
                  Pitch Planner
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col justify-center items-center text-center p-4 text-slate-500">
            <Compass className="h-10 w-10 text-slate-700 mb-2" />
            <p className="text-xs font-semibold uppercase tracking-wider">No Target Selected</p>
            <p className="text-[10px] text-slate-500 mt-1 max-w-xs leading-relaxed">Select a pulsing marker on the radar to inspect a prospect.</p>
          </div>
        )}
      </div>
    </div>
  );
}
