import React, { useState } from 'react';
import {
  Globe, MapPin, Tag, Copy, Check, Mail, UserCheck,
  MessageSquareCode, Edit3, Trash2, Sliders, Play, Sparkles, BookOpen, BadgeCheck, AlertCircle,
  Send, X
} from 'lucide-react';
import { ClientLead, UserProfile } from '../types';
import * as api from '../lib/api';

interface LeadCardProps {
  lead: ClientLead;
  onStatusChange: (id: string, status: ClientLead['status']) => void;
  onNotesChange: (id: string, notes: string) => void;
  onSelectStrategy: (lead: ClientLead) => void;
  onDelete: (id: string) => void;
  onCustomizeTemplate: (lead: ClientLead) => void;
  profile: UserProfile;
}

export default function LeadCard({
  lead,
  onStatusChange,
  onNotesChange,
  onSelectStrategy,
  onDelete,
  onCustomizeTemplate,
  profile
}: LeadCardProps) {
  const [copied, setCopied] = useState(false);
  const [editingNotes, setEditingNotes] = useState(false);
  const [noteText, setNoteText] = useState(lead.notes || '');
  const [showSendModal, setShowSendModal] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const previewBody = (() => {
    const template = lead.outreachTemplate || '';
    const subjMatch = template.match(/^Subject:\s*(.+?)\r?\n/);
    const subject = subjMatch?.[1]?.trim() ?? `Hello from ${profile.fullName}`;
    const body = subjMatch ? template.slice(subjMatch[0].length).trimStart() : template;
    const footer = [
      '',
      '--',
      profile.fullName,
      profile.portfolioUrl,
      profile.email,
      profile.physicalAddress || '[Add a physical address in Profile Settings — required for CAN-SPAM]',
      'You can opt out of any further messages by replying with the word STOP. This is a one-off, individually-sent outreach — not a marketing list.',
    ]
      .filter(Boolean)
      .join('\n');
    return { subject, body: `${body}\n${footer}` };
  })();

  const copyOutreach = () => {
    const customized = lead.outreachTemplate
      .replaceAll('[My Name]', profile.fullName)
      .replaceAll('[Your Name]', profile.fullName);
    navigator.clipboard.writeText(customized);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const doSend = async () => {
    setSending(true);
    setSendError(null);
    try {
      const result = await api.sendEmail(lead.id);
      setShowSendModal(false);
      onStatusChange(lead.id, 'Contacted');
      // soft notice — let App.tsx surface the daily quota if it wants to
      alert(`Sent! Message ID: ${result.messageId}\nToday: ${result.sentToday}/${result.dailyCap}`);
    } catch (err) {
      if (err instanceof api.SendEmailError) {
        if (err.code === 'gmail_not_connected') {
          setSendError('Gmail is not connected. Open Profile Settings → Gmail → Connect.');
        } else if (err.code === 'daily_cap') {
          setSendError(err.message);
        } else if (err.code === 'suppressed') {
          setSendError(err.message);
        } else {
          setSendError(err.message);
        }
      } else if (err instanceof Error) {
        setSendError(err.message);
      } else {
        setSendError('Send failed.');
      }
    } finally {
      setSending(false);
    }
  };

  const saveNotes = () => {
    onNotesChange(lead.id, noteText);
    setEditingNotes(false);
  };

  const getStatusColor = (status: ClientLead['status']) => {
    switch (status) {
      case 'Lead':
        return 'bg-blue-50 text-blue-700 border-blue-200';
      case 'Contacted':
        return 'bg-amber-50 text-amber-700 border-amber-200';
      case 'In Discussion':
        return 'bg-indigo-50 text-indigo-700 border-indigo-200';
      case 'Replied':
        return 'bg-emerald-50 text-emerald-700 border-emerald-200';
      case 'Declined':
        return 'bg-rose-50 text-rose-700 border-rose-200';
      case 'Archived':
        return 'bg-slate-100 text-slate-700 border-slate-200';
      default:
        return 'bg-slate-50 text-slate-700 border-slate-200';
    }
  };

  // Safe helper to render strings perfectly
  const getCleanHref = (url: string) => {
    if (!url) return '#';
    return url.startsWith('http') ? url : `https://${url}`;
  };

  return (
    <div id={`lead-card-${lead.id}`} className="bg-white border border-slate-100 rounded-2xl p-6 shadow-sm hover:shadow-md transition-all duration-200 flex flex-col h-full justify-between">
      <div>
        {/* Header: Title and Status */}
        <div className="flex justify-between items-start gap-4 mb-3">
          <div>
            <h3 className="text-base font-semibold text-slate-800 leading-snug flex items-center gap-1.5 flex-wrap">
              {lead.name}
              {lead.website && (
                <a
                  href={getCleanHref(lead.website)}
                  target="_blank"
                  rel="noreferrer"
                  id={`lead-website-link-${lead.id}`}
                  className="text-slate-400 hover:text-indigo-600 inline-flex transition-colors cursor-pointer"
                  title="Visit Website"
                >
                  <Globe className="h-3.5 w-3.5" />
                </a>
              )}
            </h3>
            <div className="flex items-center gap-1 text-xs text-slate-400 mt-1">
              <MapPin className="h-3 w-3 text-slate-400 flex-shrink-0" />
              <span>{lead.location}</span>
              <span className="mx-1">•</span>
              <span className="text-slate-500 font-medium">{lead.industry}</span>
            </div>
          </div>

          <div className="flex items-center gap-1.5 flex-shrink-0">
            <select
              id={`lead-status-select-${lead.id}`}
              value={lead.status}
              onChange={(e) => onStatusChange(lead.id, e.target.value as ClientLead['status'])}
              className={`text-xs px-2.5 py-1 rounded-full border-1 outline-none font-medium transition-colors ${getStatusColor(lead.status)}`}
            >
              <option value="Lead">Lead</option>
              <option value="Contacted">Contacted</option>
              <option value="In Discussion">In Discussion</option>
              <option value="Replied">Replied</option>
              <option value="Declined">Declined</option>
              <option value="Archived">Archived</option>
            </select>
          </div>
        </div>

        {/* Description */}
        <p className="text-xs text-slate-600 line-clamp-3 mb-4 leading-relaxed bg-slate-50 p-2.5 rounded-xl border border-slate-100/50">
          {lead.description}
        </p>

        {/* Identified Client Tech Needs */}
        <div className="mb-4">
          <h4 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1">
            <Sliders className="h-3 w-3 text-indigo-500" /> Potential Tech Gaps & Needs
          </h4>
          <ul className="space-y-1.5">
            {lead.potentialNeeds.map((need, index) => (
              <li key={index} className="flex gap-2 items-start text-xs text-slate-600">
                <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 mt-1.5 flex-shrink-0" />
                <span className="hover:text-slate-800 transition-colors leading-normal">{need}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Ideal Tech Stack recommendations */}
        <div className="mb-4">
          <h4 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1.5 flex items-center gap-1">
            <Tag className="h-3 w-3 text-emerald-500" /> Recommended Stack Solutions
          </h4>
          <div className="flex flex-wrap gap-1">
            {lead.suggestedStack.map((tech) => (
              <span
                key={tech}
                className="bg-slate-50 text-slate-600 text-[10px] px-2 py-0.5 rounded font-mono border border-slate-100"
              >
                {tech}
              </span>
            ))}
          </div>
        </div>

        {/* Contact/Reach Out Info */}
        <div className="bg-indigo-50/20 border border-indigo-100/30 rounded-xl p-3 mb-4 flex items-center gap-3">
          <div className="bg-indigo-50 p-1.5 rounded-lg">
            <UserCheck className="h-4 w-4 text-indigo-600" />
          </div>
          <div>
            <div className="text-[11px] font-medium text-slate-400">Target Persona / Contact</div>
            <div className="text-xs font-semibold text-slate-700 flex items-center gap-1.5 flex-wrap">
              <span>{lead.contactPerson || 'Decision Maker'}</span>
              <span className="text-slate-300">•</span>
              {lead.contactEmail ? (
                <a
                  href={`mailto:${lead.contactEmail}`}
                  id={`lead-email-mailto-${lead.id}`}
                  className="text-indigo-600 hover:underline inline-flex items-center gap-1"
                  title="Send Email"
                >
                  <Mail className="h-3 w-3 inline" />
                  <span className="text-[11px]">{lead.contactEmail}</span>
                  {(() => {
                    const m = lead.verificationMethod ?? (lead.emailVerified ? 'rcpt' : 'unverified');
                    if (m === 'rcpt') return (
                      <span title="SMTP RCPT TO accepted (high confidence)" className="inline-flex items-center gap-0.5 text-emerald-600 text-[10px] font-medium">
                        <BadgeCheck className="h-3 w-3" /> SMTP
                      </span>
                    );
                    if (m === 'mx-only') return (
                      <span title="Domain has MX records but SMTP probe was blocked or inconclusive" className="inline-flex items-center gap-0.5 text-amber-600 text-[10px] font-medium">
                        <AlertCircle className="h-3 w-3" /> MX only
                      </span>
                    );
                    if (m === 'scraped') return (
                      <span title="Email harvested from a public contact page; not SMTP-verified" className="inline-flex items-center gap-0.5 text-amber-600 text-[10px] font-medium">
                        <AlertCircle className="h-3 w-3" /> scraped
                      </span>
                    );
                    if (m === 'pattern') return (
                      <span title="Guessed from a common name pattern; treat as unverified" className="inline-flex items-center gap-0.5 text-rose-600 text-[10px] font-medium">
                        <AlertCircle className="h-3 w-3" /> pattern
                      </span>
                    );
                    return (
                      <span title="Unverified" className="inline-flex items-center gap-0.5 text-slate-400 text-[10px] font-medium">
                        <AlertCircle className="h-3 w-3" /> unverified
                      </span>
                    );
                  })()}
                </a>
              ) : (
                <span className="text-slate-400 text-[11px] flex items-center gap-1">
                  <Mail className="h-3 w-3 inline" /> Unlisted
                </span>
              )}
              <div className="mt-2 flex items-center gap-2 flex-wrap">
                <span className="text-[11px] text-slate-400">Business phone:</span>
                {lead.contactPhone ? (
                  <a href={`tel:${lead.contactPhone.replace(/[^+\d]/g, '')}`} className="text-xs font-semibold text-indigo-700 hover:underline" title="Call this publicly listed business number">
                    {lead.contactPhone}
                  </a>
                ) : (
                  <span className="text-[11px] text-slate-400">Not found on scanned public pages</span>
                )}
              </div>
            </div>
          </div>
        </div>

        <details className="mb-4 rounded-xl border border-slate-200 bg-white">
          <summary className="cursor-pointer list-none px-3 py-2.5 text-xs font-semibold text-slate-700 flex items-center justify-between">
            <span>Call & text playbook</span>
            <span className="text-[10px] font-normal text-slate-400">Drafts for your review</span>
          </summary>
          <div className="px-3 pb-3 space-y-3">
            <div>
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Text message</span>
                <button type="button" disabled={!lead.smsTemplate} onClick={() => navigator.clipboard.writeText(lead.smsTemplate ?? '')} className="text-[10px] font-semibold text-indigo-600 disabled:text-slate-300">Copy text</button>
              </div>
              <p className="text-xs leading-relaxed text-slate-600 whitespace-pre-wrap">{lead.smsTemplate || 'No text draft yet. Regenerate outreach after enabling the multi-channel draft update.'}</p>
            </div>
            <div className="border-t border-slate-100 pt-3">
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Cold-call opener</span>
                <button type="button" disabled={!lead.coldCallScript} onClick={() => navigator.clipboard.writeText(lead.coldCallScript ?? '')} className="text-[10px] font-semibold text-indigo-600 disabled:text-slate-300">Copy script</button>
              </div>
              <p className="text-xs leading-relaxed text-slate-600 whitespace-pre-wrap">{lead.coldCallScript || 'No cold-call script yet.'}</p>
            </div>
            <div className="border-t border-slate-100 pt-3">
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Voicemail</span>
                <button type="button" disabled={!lead.voicemailScript} onClick={() => navigator.clipboard.writeText(lead.voicemailScript ?? '')} className="text-[10px] font-semibold text-indigo-600 disabled:text-slate-300">Copy script</button>
              </div>
              <p className="text-xs leading-relaxed text-slate-600 whitespace-pre-wrap">{lead.voicemailScript || 'No voicemail script yet.'}</p>
            </div>
            <p className="text-[10px] text-amber-700 bg-amber-50 rounded-lg p-2">These are drafts, not permission to text or call. Confirm the right contact and applicable outreach rules before using them.</p>
          </div>
        </details>
      </div>

      {/* CRM Notes & Actions */}
      <div className="mt-4 pt-4 border-t border-slate-100 space-y-3">
        {/* Lead Notes Box */}
        <div>
          {editingNotes ? (
            <div className="space-y-1.5">
              <textarea
                id={`note-textarea-${lead.id}`}
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                placeholder="Log notes about contact person, dates, response, etc."
                rows={2}
                className="w-full text-xs p-2 border border-slate-200 rounded-lg focus:ring-1 focus:ring-indigo-500 focus:outline-none bg-slate-50"
              />
              <div className="flex justify-end gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    setNoteText(lead.notes || '');
                    setEditingNotes(false);
                  }}
                  className="text-[11px] px-2 py-1 text-slate-500 hover:bg-slate-50 rounded"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  id={`note-save-btn-${lead.id}`}
                  onClick={saveNotes}
                  className="text-[11px] px-2.5 py-1 bg-indigo-600 text-white rounded font-medium hover:bg-indigo-700"
                >
                  Save Notes
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-start justify-between gap-2">
              <p className="text-[11px] text-slate-500 italic truncate flex-1 leading-normal">
                {lead.notes ? `Notes: ${lead.notes}` : 'No notes written. Click edit to log a comment.'}
              </p>
              <button
                type="button"
                id={`note-edit-pencil-${lead.id}`}
                onClick={() => setEditingNotes(true)}
                className="text-slate-400 hover:text-indigo-600 p-0.5 transition-colors cursor-pointer"
                title="Edit notes"
              >
                <Edit3 className="h-3 w-3" />
              </button>
            </div>
          )}
        </div>

        {/* Dynamic Action Buttons */}
        <div className="grid grid-cols-3 gap-2">
          {/* Send via Gmail (Phase 3) */}
          <button
            type="button"
            id={`send-gmail-btn-${lead.id}`}
            onClick={() => { setSendError(null); setShowSendModal(true); }}
            disabled={!lead.contactEmail}
            className="py-2 px-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-200 disabled:text-slate-400 text-white rounded-xl flex items-center justify-center gap-1.5 text-xs font-semibold cursor-pointer transition-all active:scale-95 disabled:cursor-not-allowed"
            title={lead.contactEmail ? 'Send via Gmail' : 'No contact email — cannot send'}
          >
            <Send className="h-3.5 w-3.5" />
            <span>Send</span>
          </button>

          {/* Quick Copy Outreach Campaign */}
          <button
            type="button"
            id={`copy-outreach-btn-${lead.id}`}
            onClick={copyOutreach}
            className={`py-2 px-2 border rounded-xl flex items-center justify-center gap-1.5 text-xs font-semibold cursor-pointer transition-all ${
              copied
                ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                : 'bg-white hover:bg-slate-50 border-slate-200 text-slate-700'
            }`}
          >
            {copied ? (
              <>
                <Check className="h-3.5 w-3.5 text-emerald-600" />
                <span>Copied</span>
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5" />
                <span>Copy</span>
              </>
            )}
          </button>

          {/* Formulate Pitch Strategy */}
          <button
            type="button"
            id={`consult-pitch-btn-${lead.id}`}
            onClick={() => onSelectStrategy(lead)}
            className="py-2 px-2 bg-indigo-50 hover:bg-indigo-100 border border-indigo-100 text-indigo-700 rounded-xl flex items-center justify-center gap-1.5 text-xs font-semibold cursor-pointer transition-all active:scale-95"
          >
            <BookOpen className="h-3.5 w-3.5" />
            <span>Strategy</span>
          </button>
        </div>

        {showSendModal && (
          <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4" onClick={() => !sending && setShowSendModal(false)}>
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between p-4 border-b border-slate-100">
                <div>
                  <div className="text-sm font-bold text-slate-900">Send to {lead.contactEmail}</div>
                  <div className="text-[11px] text-slate-500">From your Gmail. Preview includes the CAN-SPAM footer that will be appended server-side.</div>
                </div>
                <button type="button" onClick={() => setShowSendModal(false)} disabled={sending} className="text-slate-400 hover:text-slate-700 disabled:opacity-40">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="p-4 space-y-3">
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-1">Subject</div>
                  <div className="text-sm font-semibold text-slate-800">{previewBody.subject}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-1">Body</div>
                  <pre className="text-xs text-slate-800 whitespace-pre-wrap font-sans bg-slate-50 border border-slate-100 rounded-lg p-3 max-h-96 overflow-y-auto">{previewBody.body}</pre>
                </div>
                {sendError && (
                  <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg p-3 flex items-start gap-2">
                    <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                    <span>{sendError}</span>
                  </div>
                )}
              </div>
              <div className="flex items-center justify-end gap-2 p-4 border-t border-slate-100">
                <button type="button" onClick={() => setShowSendModal(false)} disabled={sending} className="px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 rounded-lg disabled:opacity-40">Cancel</button>
                <button type="button" onClick={doSend} disabled={sending} className="px-4 py-2 text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg inline-flex items-center gap-1.5 disabled:opacity-50">
                  <Send className="h-3.5 w-3.5" />
                  {sending ? 'Sending…' : 'Send via Gmail'}
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="flex justify-between items-center text-[11px] text-slate-400 pt-1">
          <span>Added: {lead.dateAdded}</span>
          <div className="flex gap-2">
            <button
              type="button"
              id={`customize-email-btn-${lead.id}`}
              onClick={() => onCustomizeTemplate(lead)}
              className="text-slate-500 hover:text-indigo-600 font-medium inline-flex items-center gap-0.5 cursor-pointer"
              title="Customize Tone of Cold Email"
            >
              <Sliders className="h-3 w-3" /> Customize Email
            </button>
            <button
              type="button"
              id={`delete-lead-btn-${lead.id}`}
              onClick={() => onDelete(lead.id)}
              className="text-slate-400 hover:text-rose-600 transition-colors cursor-pointer"
              title="Delete lead"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
