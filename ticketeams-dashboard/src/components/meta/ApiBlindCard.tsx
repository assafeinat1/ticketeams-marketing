import type { ApiBlindCompetitor } from '../../types/api';

interface Props {
  competitor: ApiBlindCompetitor;
}

export default function ApiBlindCard({ competitor }: Props) {
  return (
    <div className="bg-card border border-orange/40 rounded-xl overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-orange/20 flex items-center justify-between bg-orange/5">
        <span className="text-xs font-bold text-orange">API Blind</span>
        <span className="w-2.5 h-2.5 rounded-full bg-orange animate-pulse" />
      </div>

      {/* Body */}
      <div className="px-4 py-4 space-y-3">
        <p className="text-sm font-semibold text-text">
          {competitor.name_he}
        </p>
        <p className="text-xs text-text-dim leading-relaxed">
          קמפיינים פעילים מוסתרים על ידי Meta API
        </p>
        <p className="text-[10px] text-text-dim/60">
          Page ID: {competitor.page_id}
        </p>
      </div>

      {/* Direct View Button */}
      <div className="px-4 py-3 border-t border-border/50">
        <a
          href={competitor.adLibraryUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-lg bg-gradient-to-l from-pink via-orange to-purple text-white text-sm font-bold transition-opacity hover:opacity-90"
        >
          <span>Direct View</span>
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
        </a>
      </div>
    </div>
  );
}
