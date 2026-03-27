import { useState, useCallback, useMemo } from 'react';
import { getHeatScores } from '../../api/intelligence';
import { getStatus, getDecisions, executeDecision } from '../../api/orchestrator';
import { getMetaCampaigns, getTokenStatus } from '../../api/meta';
import type { ScoredEvent, OrchestratorStatus, OrchestratorDecision, MetaCampaign, MetaTokenStatus } from '../../types/api';
import { usePolling } from '../../hooks/usePolling';
import { useToast } from '../../hooks/useToast';
import StatCard from '../shared/StatCard';
import StatusBadge from '../shared/StatusBadge';
import GradientButton from '../shared/GradientButton';
import SkeletonLoader from '../shared/SkeletonLoader';

function relativeTime(dateStr?: string | null): string {
  if (!dateStr) return '—';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'כרגע';
  if (mins < 60) return `לפני ${mins} דקות`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `לפני ${hours} שעות`;
  const days = Math.floor(hours / 24);
  return `לפני ${days} ימים`;
}

const TIER_COLORS: Record<string, string> = {
  onFire: '#E91E8C',
  hot: '#FF6B35',
  warm: '#7C3AED',
  cold: '#555',
};

interface HomeData {
  heatScores: ScoredEvent[];
  orchStatus: OrchestratorStatus | null;
  decisions: OrchestratorDecision[];
  campaigns: MetaCampaign[];
  tokenStatus: MetaTokenStatus | null;
}

export default function HomeTab() {
  const [data, setData] = useState<HomeData>({
    heatScores: [],
    orchStatus: null,
    decisions: [],
    campaigns: [],
    tokenStatus: null,
  });
  const [loading, setLoading] = useState(true);
  const { showToast } = useToast();

  const loadData = useCallback(async () => {
    try {
      const [heatRes, statusRes, decisionsRes, campaignsRes, tokenRes] = await Promise.allSettled([
        getHeatScores(),
        getStatus(),
        getDecisions(20),
        getMetaCampaigns(),
        getTokenStatus(),
      ]);
      setData({
        heatScores: heatRes.status === 'fulfilled' ? heatRes.value : [],
        orchStatus: statusRes.status === 'fulfilled' ? statusRes.value : null,
        decisions: decisionsRes.status === 'fulfilled' ? decisionsRes.value : [],
        campaigns: campaignsRes.status === 'fulfilled' ? campaignsRes.value : [],
        tokenStatus: tokenRes.status === 'fulfilled' ? tokenRes.value : null,
      });
    } catch {
      // Backend may not be running
    } finally {
      setLoading(false);
    }
  }, []);

  usePolling(loadData, 60000);

  // Future events only, sorted by score, top 5
  const hotEvents = useMemo(() => {
    const today = new Date().toISOString().split('T')[0];
    return data.heatScores
      .filter(e => { const d = e.eventDate || e.date; return !d || d >= today; })
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);
  }, [data.heatScores]);

  const pendingDecisions = data.decisions.filter(
    d => d.requiresApproval && (d.status === 'pending' || d.status === 'pending_approval')
  );

  const recentActions = data.decisions
    .filter(d => d.status !== 'pending' && d.status !== 'pending_approval')
    .slice(0, 5);

  const activeCampaigns = data.campaigns.filter(c =>
    c.status === 'ACTIVE' || c.status === 'PAUSED'
  );

  const tokenDays = data.tokenStatus?.daysRemaining;
  const tokenColor = tokenDays === null || tokenDays === undefined
    ? 'purple'
    : tokenDays <= 7 ? 'pink' : tokenDays <= 30 ? 'orange' : 'green';

  const handleExecuteDecision = async (decisionId: string, action: 'approve' | 'reject') => {
    try {
      await executeDecision(decisionId);
      showToast('success', `החלטה ${action === 'approve' ? 'אושרה' : 'נדחתה'} בהצלחה`);
      await loadData();
    } catch {
      showToast('error', 'שגיאה בביצוע החלטה');
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="skeleton h-8 w-64 mb-2" />
        <div className="skeleton h-4 w-48" />
        <SkeletonLoader type="cards" />
        <SkeletonLoader type="table" rows={3} />
        <SkeletonLoader type="table" rows={3} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Welcome */}
      <div>
        <h2 className="text-xl font-bold">
          <span className="bg-gradient-to-l from-pink via-orange to-purple bg-clip-text text-transparent">
            שלום אסף
          </span>
          , הנה הסיכום של היום
        </h2>
        <p className="text-sm text-text-dim mt-1">
          {new Date().toLocaleDateString('he-IL', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
        </p>
      </div>

      {/* Big Stats */}
      <div className="grid grid-cols-4 gap-4 stat-grid-responsive">
        <StatCard
          label="קמפיינים פעילים"
          value={activeCampaigns.length}
          color="pink"
          pulse={activeCampaigns.length > 0}
        />
        <StatCard
          label="אירועים חמים"
          value={hotEvents.length}
          color="orange"
          pulse={hotEvents.some(e => e.tier === 'onFire')}
        />
        <StatCard
          label="ממתינים לאישור"
          value={data.orchStatus?.pendingApprovals ?? pendingDecisions.length}
          color="purple"
          pulse={pendingDecisions.length > 0}
        />
        <StatCard
          label="Token — ימים"
          value={tokenDays ?? '—'}
          color={tokenColor}
          pulse={tokenDays != null && tokenDays <= 7}
        />
      </div>

      {/* Hot Events — top 5 future */}
      <div className="bg-card border border-border rounded-xl p-5 card-elevated accent-orange">
        <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
          <span className="w-6 h-6 rounded-lg bg-gradient-to-br from-orange/20 to-pink/20 flex items-center justify-center text-xs">
            {hotEvents.some(e => e.tier === 'onFire') ? '🔥' : '🌡️'}
          </span>
          אירועים חמים ({hotEvents.length})
        </h3>
        {hotEvents.length === 0 ? (
          <p className="text-sm text-text-dim text-center py-4">אין אירועים חמים כרגע</p>
        ) : (
          <div className="space-y-3">
            {hotEvents.map((event, i) => (
              <div key={i} className={`flex items-center justify-between bg-bg rounded-xl p-4 border border-border/50 ${event.tier === 'onFire' ? 'on-fire-row' : ''}`}>
                <div className="flex items-center gap-3">
                  <span className="text-lg">{event.tier === 'onFire' ? '🔥' : event.tier === 'hot' ? '🌡️' : '☁️'}</span>
                  <div>
                    <p className="font-medium text-sm">{event.homeTeam} vs {event.awayTeam}</p>
                    <p className="text-xs text-text-dim">{[event.competition, event.eventDate || event.date].filter(Boolean).join(' | ') || ''}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2">
                    <div className="w-20 h-2 bg-bg-elevated rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-700"
                        style={{ width: `${event.score}%`, backgroundColor: TIER_COLORS[event.tier] || '#555' }}
                      />
                    </div>
                    <span className="text-sm font-bold" style={{ color: TIER_COLORS[event.tier] || '#888' }}>{event.score}</span>
                  </div>
                  <StatusBadge status={event.tier === 'onFire' ? 'critical' : event.tier === 'hot' ? 'high' : 'medium'} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Pending Approvals */}
      <div className="bg-card border border-border rounded-xl p-5 card-elevated accent-purple">
        <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
          <span className="w-6 h-6 rounded-lg bg-gradient-to-br from-purple/20 to-pink/20 flex items-center justify-center text-xs">
            ⏳
          </span>
          פעולות ממתינות ({pendingDecisions.length})
        </h3>
        {pendingDecisions.length === 0 ? (
          <p className="text-sm text-text-dim text-center py-4">אין פעולות ממתינות</p>
        ) : (
          <div className="space-y-2">
            {pendingDecisions.slice(0, 4).map((d) => (
              <div key={d.id} className="flex items-center justify-between bg-bg rounded-xl p-3 border border-border/50">
                <div className="flex items-center gap-3">
                  <StatusBadge status={d.type} />
                  <div>
                    <p className="text-sm font-medium">
                      {d.event ? `${d.event.homeTeam} vs ${d.event.awayTeam}` : d.campaign?.name || '—'}
                    </p>
                    <p className="text-xs text-text-dim">{d.suggestedAction?.reasoning?.slice(0, 80)}{(d.suggestedAction?.reasoning?.length ?? 0) > 80 ? '...' : ''}</p>
                  </div>
                </div>
                <div className="flex gap-2 shrink-0">
                  <GradientButton
                    animateOnClick="approve"
                    className="text-xs px-3 py-1.5"
                    onClick={() => handleExecuteDecision(d.id, 'approve')}
                  >
                    אשר
                  </GradientButton>
                  <GradientButton
                    variant="danger"
                    animateOnClick="reject"
                    className="text-xs px-3 py-1.5"
                    onClick={() => handleExecuteDecision(d.id, 'reject')}
                  >
                    דחה
                  </GradientButton>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Recent Activity */}
      <div className="bg-card border border-border rounded-xl p-5 card-elevated accent-gold">
        <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
          <span className="w-6 h-6 rounded-lg bg-gradient-to-br from-gold/20 to-orange/20 flex items-center justify-center text-xs">
            📋
          </span>
          פעילות אחרונה
        </h3>
        {recentActions.length === 0 ? (
          <p className="text-sm text-text-dim text-center py-4">אין פעילות אחרונה</p>
        ) : (
          <div className="space-y-1">
            {recentActions.map((d, i) => (
              <div key={i} className="flex items-center justify-between py-2.5 px-3 rounded-lg hover:bg-card-hover transition-colors">
                <div className="flex items-center gap-3">
                  <div className="w-2 h-2 rounded-full bg-green shrink-0" />
                  <div>
                    <p className="text-sm">
                      <StatusBadge status={d.type} size="sm" />
                      <span className="mr-2">
                        {d.event ? `${d.event.homeTeam} vs ${d.event.awayTeam}` : d.campaign?.name || '—'}
                      </span>
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <StatusBadge status={d.status} size="sm" />
                  <span className="text-[10px] text-text-dim whitespace-nowrap">{relativeTime(d.createdAt)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
