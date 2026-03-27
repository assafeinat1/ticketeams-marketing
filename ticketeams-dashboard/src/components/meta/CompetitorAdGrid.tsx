import { useState } from 'react';
import type { CompetitorAdEntry, ApiBlindCompetitor } from '../../types/api';
import StatusBadge from '../shared/StatusBadge';
import Tooltip from '../ui/Tooltip';
import ApiBlindCard from './ApiBlindCard';

interface SourceInfo {
  label: string;
  count: number;
  status: string;
  error: string | null;
}

interface Props {
  ads: CompetitorAdEntry[];
  scannedAt: string;
  sources?: SourceInfo[];
  apiBlindCompetitors?: ApiBlindCompetitor[];
}

const FORMAT_COLORS: Record<string, string> = {
  Stadium: 'border-purple/40',
  Human: 'border-pink/40',
  Urgency: 'border-orange/40',
};

const FORMAT_ICONS: Record<string, string> = {
  Stadium: '🏟️',
  Human: '👤',
  Urgency: '⚡',
};

export default function CompetitorAdGrid({ ads, scannedAt, sources, apiBlindCompetitors }: Props) {
  const [filter, setFilter] = useState<string>('all');

  const filteredAds = filter === 'all' ? ads : ads.filter((ad) => ad.classification.format_type === filter);

  const formatCounts = ads.reduce<Record<string, number>>((acc, ad) => {
    const type = ad.classification.format_type || 'Unknown';
    acc[type] = (acc[type] || 0) + 1;
    return acc;
  }, {});

  return (
    <div className="space-y-4">
      {/* Header + Filter */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-medium text-text-dim">
            פרסומות מתחרים — Ad Library
          </h3>
          <span className="text-xs text-text-dim/60">
            {new Date(scannedAt).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>

        {/* Format type filter chips */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setFilter('all')}
            className={`text-xs px-2.5 py-1 rounded-full transition-colors ${
              filter === 'all'
                ? 'bg-pink/20 text-pink'
                : 'bg-card text-text-dim hover:bg-border'
            }`}
          >
            הכל ({ads.length})
          </button>
          {Object.entries(formatCounts).map(([type, count]) => (
            <button
              key={type}
              onClick={() => setFilter(type)}
              className={`text-xs px-2.5 py-1 rounded-full transition-colors ${
                filter === type
                  ? 'bg-pink/20 text-pink'
                  : 'bg-card text-text-dim hover:bg-border'
              }`}
            >
              {FORMAT_ICONS[type] || '❓'} {type} ({count})
            </button>
          ))}
        </div>
      </div>

      {/* Source Debug Panel — shown when no ads found */}
      {ads.length === 0 && sources && sources.length > 0 && (
        <div className="bg-orange/5 border border-orange/20 rounded-xl p-4 space-y-2">
          <h4 className="text-xs font-bold text-orange">Debug — תוצאות לפי מקור</h4>
          <div className="space-y-1">
            {sources.map((s, i) => (
              <div key={i} className="flex items-center gap-2 text-xs">
                <span className={`w-2 h-2 rounded-full ${s.count > 0 ? 'bg-green' : s.status === 'error' ? 'bg-red' : 'bg-text-dim'}`} />
                <span className="font-medium">{s.label}</span>
                <span className="text-text-dim">— {s.count} ads ({s.status})</span>
                {s.error && <span className="text-red">{s.error}</span>}
              </div>
            ))}
          </div>
          <p className="text-[10px] text-text-dim mt-2">
            בדוק את הטרמינל לפרטי Debug נוספים (request params, API response)
          </p>
        </div>
      )}

      {/* API-Blind Competitors */}
      {apiBlindCompetitors && apiBlindCompetitors.length > 0 && (
        <div className="grid grid-cols-3 gap-4">
          {apiBlindCompetitors.map((comp) => (
            <ApiBlindCard key={comp.page_id} competitor={comp} />
          ))}
        </div>
      )}

      {/* Ads Grid */}
      {filteredAds.length === 0 && ads.length > 0 ? (
        <p className="text-center text-sm text-text-dim py-8">אין פרסומות בקטגוריה זו</p>
      ) : filteredAds.length === 0 ? null : (
        <div className="grid grid-cols-3 gap-4">
          {filteredAds.map((ad, i) => (
            <CompetitorCard key={`${ad.page_name}-${i}`} ad={ad} />
          ))}
        </div>
      )}
    </div>
  );
}

function CompetitorCard({ ad }: { ad: CompetitorAdEntry }) {
  const borderClass = FORMAT_COLORS[ad.classification.format_type] || 'border-border';

  return (
    <div className={`bg-card border ${borderClass} rounded-xl overflow-hidden hover:border-pink/60 transition-colors`}>
      {/* Header: page name + format badge */}
      <div className="px-4 py-3 border-b border-border/50 flex items-center justify-between">
        <span className="text-xs font-medium truncate max-w-[60%]">{ad.page_name}</span>
        <StatusBadge status={ad.classification.format_type} />
      </div>

      {/* Ad body */}
      <div className="px-4 py-3 space-y-2">
        {ad.title && (
          <p className="text-sm font-semibold line-clamp-2">{ad.title}</p>
        )}
        <p className="text-xs text-text-dim line-clamp-3">{ad.body || 'ללא טקסט'}</p>
        {ad.description && (
          <p className="text-xs text-text-dim/70 line-clamp-1">{ad.description}</p>
        )}
      </div>

      {/* Footer: match info + delivery date */}
      <div className="px-4 py-2.5 border-t border-border/50 flex items-center justify-between">
        {ad.match_info.matched ? (
          <Tooltip content={`${ad.match_info.homeTeam} vs ${ad.match_info.awayTeam}`}>
            <span className="text-xs text-green font-medium truncate max-w-[60%]">
              {ad.match_info.homeTeam} vs {ad.match_info.awayTeam}
            </span>
          </Tooltip>
        ) : (
          <span className="text-xs text-text-dim/50">ללא התאמה לאירוע</span>
        )}

        <div className="flex items-center gap-2">
          {ad.delivery_start && (
            <span className="text-[10px] text-text-dim/50">
              {new Date(ad.delivery_start).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit' })}
            </span>
          )}
          {ad.snapshot_url && (
            <a
              href={ad.snapshot_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[10px] text-pink hover:underline"
            >
              צפה
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
