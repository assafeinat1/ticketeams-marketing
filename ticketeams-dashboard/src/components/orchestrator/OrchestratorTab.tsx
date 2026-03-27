import { useState, useCallback, useMemo } from 'react';
import { getStatus, getDecisions, getConfig, triggerHotCheck, triggerPerfCheck, executeDecision, setupBoard, runFullPipeline } from '../../api/orchestrator';
import { triggerScan } from '../../api/intelligence';
import { getTokenStatus } from '../../api/meta';
import type { OrchestratorStatus, OrchestratorDecision, OrchestratorConfig, MetaTokenStatus } from '../../types/api';
import { usePolling } from '../../hooks/usePolling';
import { useToast } from '../../hooks/useToast';
import StatCard from '../shared/StatCard';
import StatusBadge from '../shared/StatusBadge';
import GradientButton from '../shared/GradientButton';
import SkeletonLoader from '../shared/SkeletonLoader';
import Dialog from '../ui/Dialog';
import AgentChat from '../chat/AgentChat';

// ── Helpers ──────────────────────────────────────────────────

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

function agentHealthClass(lastRun?: string | null): string {
  if (!lastRun) return 'status-dot-offline';
  const diff = Date.now() - new Date(lastRun).getTime();
  const hours = diff / 3600000;
  if (hours < 1) return 'status-dot-online';
  if (hours < 24) return 'status-dot-stale';
  return 'status-dot-offline';
}

function agentHealthLabel(lastRun?: string | null): string {
  if (!lastRun) return 'לא פעיל';
  const diff = Date.now() - new Date(lastRun).getTime();
  const hours = diff / 3600000;
  if (hours < 1) return 'פעיל';
  if (hours < 24) return 'לא עדכני';
  return 'לא פעיל';
}

function tokenCountdown(tokenStatus: MetaTokenStatus | null): string {
  if (!tokenStatus?.daysRemaining) return '—';
  const days = tokenStatus.daysRemaining;
  if (tokenStatus.expiresAt) {
    const diff = new Date(tokenStatus.expiresAt).getTime() - Date.now();
    const hours = Math.floor((diff % 86400000) / 3600000);
    if (days > 0) return `${days} ימים, ${hours} שעות`;
    return `${hours} שעות`;
  }
  return `${days} ימים`;
}

const TIER_COLORS: Record<string, string> = {
  onFire: '#E91E8C',
  hot: '#FF6B35',
  warm: '#7C3AED',
  cold: '#555',
};

// ── Component ────────────────────────────────────────────────

export default function OrchestratorTab() {
  const [status, setStatus] = useState<OrchestratorStatus | null>(null);
  const [decisions, setDecisions] = useState<OrchestratorDecision[]>([]);
  const [config, setConfig] = useState<OrchestratorConfig | null>(null);
  const [tokenStatus, setTokenStatus] = useState<MetaTokenStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirmAction, setConfirmAction] = useState<{ id: string; type: 'approve' | 'reject'; label: string } | null>(null);
  const [acting, setActing] = useState(false);
  const [triggering, setTriggering] = useState<string | null>(null);
  const { showToast } = useToast();

  const loadData = useCallback(async () => {
    try {
      const [statusRes, decisionsRes, configRes, tokenRes] = await Promise.allSettled([
        getStatus(),
        getDecisions(20),
        getConfig(),
        getTokenStatus(),
      ]);
      if (statusRes.status === 'fulfilled') setStatus(statusRes.value);
      if (decisionsRes.status === 'fulfilled') setDecisions(decisionsRes.value);
      if (configRes.status === 'fulfilled') setConfig(configRes.value);
      if (tokenRes.status === 'fulfilled') setTokenStatus(tokenRes.value);
    } catch {
      // Backend may not be running
    } finally {
      setLoading(false);
    }
  }, []);

  usePolling(loadData, 30000);

  const handleExecuteDecision = async () => {
    if (!confirmAction) return;
    setActing(true);
    try {
      await executeDecision(confirmAction.id);
      showToast('success', `החלטה ${confirmAction.type === 'approve' ? 'אושרה' : 'נדחתה'} בהצלחה`);
      await loadData();
    } catch {
      showToast('error', 'שגיאה בביצוע החלטה');
    } finally {
      setActing(false);
      setConfirmAction(null);
    }
  };

  const handleTrigger = async (key: string, fn: () => Promise<unknown>, label: string) => {
    setTriggering(key);
    try {
      await fn();
      showToast('success', `${label} הופעל בהצלחה`);
      setTimeout(loadData, 3000);
    } catch {
      showToast('error', `שגיאה בהפעלת ${label}`);
    } finally {
      setTriggering(null);
    }
  };

  const handleSetupBoard = async () => {
    try {
      const result = await setupBoard();
      showToast('success', `לוח אישורים נוצר${result.boardId ? ` (${result.boardId})` : ''}`);
      await loadData();
    } catch {
      showToast('error', 'שגיאה ביצירת לוח אישורים');
    }
  };

  const pendingDecisions = useMemo(() =>
    decisions.filter(d => d.requiresApproval && (d.status === 'pending' || d.status === 'pending_approval')),
    [decisions]
  );

  const recentDecisions = useMemo(() =>
    decisions.filter(d => d.status !== 'pending' && d.status !== 'pending_approval'),
    [decisions]
  );

  const decisionTarget = (d: OrchestratorDecision): string => {
    if (d.event) return `${d.event.homeTeam} vs ${d.event.awayTeam}`;
    if (d.campaign) return d.campaign.name;
    return '—';
  };

  const typeAccent: Record<string, string> = {
    CREATE_CAMPAIGN: 'accent-pink',
    PAUSE_CAMPAIGN: 'accent-red',
    INCREASE_BUDGET: 'accent-green',
    REDUCE_BUDGET: 'accent-orange',
    BOOST_CAMPAIGN: 'accent-purple',
    FLAG_IN_REPORT: 'accent-gold',
  };

  const typeIcon: Record<string, string> = {
    CREATE_CAMPAIGN: '🚀',
    PAUSE_CAMPAIGN: '⏸️',
    INCREASE_BUDGET: '📈',
    REDUCE_BUDGET: '📉',
    BOOST_CAMPAIGN: '⚡',
    FLAG_IN_REPORT: '🏁',
  };

  // ── Timeline schedule items ────────────────────────────────

  const scheduleItems = useMemo(() => {
    if (!config || !status) return [];
    const now = new Date();
    const items: { key: string; label: string; time: string; icon: string; lastRun?: string | null; status: 'done' | 'running' | 'upcoming' }[] = [];

    // Hot check — typically 07:15
    const hotHour = 7;
    const hotDone = status.lastHotCheck && new Date(status.lastHotCheck).toDateString() === now.toDateString();
    items.push({
      key: 'hot',
      label: 'בדיקת אירועים חמים',
      time: '07:15',
      icon: '🔥',
      lastRun: status.lastHotCheck,
      status: hotDone ? 'done' : now.getHours() >= hotHour ? 'running' : 'upcoming',
    });

    // Perf checks — every 6 hours (06:00, 12:00, 18:00, 00:00)
    const perfHours = [6, 12, 18, 0];
    const currentSlot = perfHours.filter(h => h <= now.getHours()).pop() ?? 0;
    const perfDone = status.lastPerfCheck && (Date.now() - new Date(status.lastPerfCheck).getTime()) < 6 * 3600000;
    perfHours.forEach(h => {
      const isDone = h <= now.getHours() && (h < currentSlot || perfDone);
      const isCurrent = h === currentSlot && !perfDone;
      items.push({
        key: `perf-${h}`,
        label: `ניטור ביצועים`,
        time: `${String(h).padStart(2, '0')}:00`,
        icon: '📊',
        lastRun: h === currentSlot ? status.lastPerfCheck : undefined,
        status: isDone ? 'done' : isCurrent ? 'running' : 'upcoming',
      });
    });

    return items.sort((a, b) => {
      const [ah, am] = a.time.split(':').map(Number);
      const [bh, bm] = b.time.split(':').map(Number);
      return (ah * 60 + am) - (bh * 60 + bm);
    });
  }, [config, status]);

  // ── Agent status indicators ────────────────────────────────

  const agents = useMemo(() => {
    if (!status) return [];
    return [
      { key: 'orchestrator', label: 'מתכלל', icon: '🧠', lastRun: status.lastRun },
      { key: 'hotCheck', label: 'Hot Check', icon: '🔥', lastRun: status.lastHotCheck },
      { key: 'perfCheck', label: 'Perf Monitor', icon: '📊', lastRun: status.lastPerfCheck },
    ];
  }, [status]);

  const tokenDays = tokenStatus?.daysRemaining;
  const tokenColor = tokenDays === null || tokenDays === undefined
    ? 'purple'
    : tokenDays <= 7 ? 'pink' : tokenDays <= 30 ? 'orange' : 'green';

  if (loading) return (
    <div className="space-y-5">
      <div className="skeleton h-6 w-48" />
      <SkeletonLoader type="cards" />
      <SkeletonLoader type="table" rows={4} />
    </div>
  );

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold">מתכלל — Orchestrator Control</h2>
        <GradientButton
          variant="ghost"
          className="text-xs px-3 py-1.5"
          onClick={() => loadData()}
        >
          רענן
        </GradientButton>
      </div>

      {/* Status Cards */}
      {status && (
        <div className="grid grid-cols-4 gap-3 stat-grid-responsive">
          <StatCard
            label="לוח Monday"
            value={status.approvalBoardConfigured ? 'מוגדר' : 'לא מוגדר'}
            color={status.approvalBoardConfigured ? 'green' : 'orange'}
          />
          <StatCard
            label="ממתינים לאישור"
            value={status.pendingApprovals}
            color={status.pendingApprovals > 0 ? 'orange' : 'green'}
            pulse={status.pendingApprovals > 0}
          />
          <StatCard label="הרצה אחרונה" value={relativeTime(status.lastRun)} color="pink" />
          <StatCard
            label="Token"
            value={tokenCountdown(tokenStatus)}
            color={tokenColor}
            pulse={tokenDays != null && tokenDays <= 7}
          />
        </div>
      )}

      {/* System Status — Agent Health */}
      <div className="bg-card border border-border rounded-xl p-5 card-elevated accent-blue">
        <h3 className="text-xs font-medium text-text-dim mb-4">סטטוס סוכנים</h3>
        <div className="grid grid-cols-3 gap-3 stat-grid-responsive">
          {agents.map(agent => (
            <div key={agent.key} className="flex items-center gap-3 bg-bg rounded-xl p-3 border border-border/50">
              <div className="relative">
                <span className="text-xl">{agent.icon}</span>
                <div className={`absolute -bottom-0.5 -left-0.5 w-2.5 h-2.5 rounded-full ${agentHealthClass(agent.lastRun)}`} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{agent.label}</p>
                <p className="text-[10px] text-text-dim">{agentHealthLabel(agent.lastRun)} · {relativeTime(agent.lastRun)}</p>
              </div>
            </div>
          ))}
          {/* Token card */}
          <div className="flex items-center gap-3 bg-bg rounded-xl p-3 border border-border/50">
            <div className="relative">
              <span className="text-xl">🔑</span>
              <div className={`absolute -bottom-0.5 -left-0.5 w-2.5 h-2.5 rounded-full ${
                tokenDays == null ? 'status-dot-offline' :
                tokenDays <= 7 ? 'status-dot-offline' :
                tokenDays <= 30 ? 'status-dot-stale' : 'status-dot-online'
              }`} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">Meta Token</p>
              <p className="text-[10px] text-text-dim">{tokenCountdown(tokenStatus)}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Pending Decisions — Large cards */}
      {pendingDecisions.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-xs font-medium text-text-dim flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-orange animate-pulse" />
            החלטות ממתינות לאישור ({pendingDecisions.length})
          </h3>
          {pendingDecisions.map((d) => (
            <div key={d.id} className={`bg-card border border-border rounded-xl overflow-hidden card-elevated ${typeAccent[d.type] || 'accent-orange'}`}>
              <div className="p-5">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className="text-lg">{typeIcon[d.type] || '📋'}</span>
                    <StatusBadge status={d.type} />
                    <StatusBadge status={d.priority} />
                    <span className="font-semibold">{decisionTarget(d)}</span>
                  </div>
                  <span className="text-[10px] text-text-dim">{relativeTime(d.createdAt)}</span>
                </div>

                {/* Metrics */}
                <div className="flex items-center gap-4 mb-3">
                  {d.event?.score != null && (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-text-dim">Heat:</span>
                      <div className="w-20 h-2 bg-bg-elevated rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-700"
                          style={{
                            width: `${d.event.score}%`,
                            backgroundColor: d.event.score >= 80 ? TIER_COLORS.onFire : d.event.score >= 60 ? TIER_COLORS.hot : TIER_COLORS.warm,
                          }}
                        />
                      </div>
                      <span className="text-xs font-bold text-pink">{d.event.score}</span>
                    </div>
                  )}
                  {d.campaign?.roas != null && (
                    <span className="text-xs text-text-dim">
                      ROAS: <span className={`font-bold ${d.campaign.roas < 1 ? 'text-red' : d.campaign.roas >= 3 ? 'text-green' : 'text-text'}`}>{d.campaign.roas.toFixed(1)}x</span>
                    </span>
                  )}
                  {d.suggestedAction?.suggestedBudgetILS != null && (
                    <span className="text-xs text-text-dim">
                      תקציב: <span className="text-text font-medium">₪{d.suggestedAction.suggestedBudgetILS.toLocaleString('he-IL')}</span>
                    </span>
                  )}
                </div>

                {d.suggestedAction?.reasoning && (
                  <p className="text-xs text-text-dim mb-4 bg-bg rounded-lg p-3 border border-border/30">{d.suggestedAction.reasoning}</p>
                )}

                <div className="flex gap-2">
                  <GradientButton
                    animateOnClick="approve"
                    onClick={() => setConfirmAction({ id: d.id, type: 'approve', label: decisionTarget(d) })}
                  >
                    אשר
                  </GradientButton>
                  <GradientButton
                    variant="danger"
                    animateOnClick="reject"
                    onClick={() => setConfirmAction({ id: d.id, type: 'reject', label: decisionTarget(d) })}
                  >
                    דחה
                  </GradientButton>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Executed Decisions — Table */}
      {recentDecisions.length > 0 && (
        <div className="bg-card border border-border rounded-xl p-5 accent-gold card-elevated">
          <h3 className="text-xs font-medium text-text-dim mb-4">יומן החלטות שבוצעו ({recentDecisions.length})</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[600px]">
              <thead>
                <tr className="border-b border-border text-text-dim bg-bg-elevated/50">
                  <th className="text-right py-3 px-3 font-semibold text-xs uppercase tracking-wide">זמן</th>
                  <th className="text-right py-3 px-3 font-semibold text-xs uppercase tracking-wide">סוג</th>
                  <th className="text-right py-3 px-3 font-semibold text-xs uppercase tracking-wide">יעד</th>
                  <th className="text-right py-3 px-3 font-semibold text-xs uppercase tracking-wide">סטטוס</th>
                  <th className="text-right py-3 px-3 font-semibold text-xs uppercase tracking-wide">פעולה</th>
                </tr>
              </thead>
              <tbody>
                {recentDecisions.map((d) => (
                  <tr key={d.id} className="border-b border-border/50 hover:bg-card-hover transition-colors">
                    <td className="py-2.5 px-3 text-text-dim text-xs whitespace-nowrap">{relativeTime(d.createdAt)}</td>
                    <td className="py-2.5 px-3">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs">{typeIcon[d.type] || '📋'}</span>
                        <StatusBadge status={d.type} />
                      </div>
                    </td>
                    <td className="py-2.5 px-3 font-medium text-sm">{decisionTarget(d)}</td>
                    <td className="py-2.5 px-3"><StatusBadge status={d.status === 'approved' ? 'approved' : d.status} /></td>
                    <td className="py-2.5 px-3 text-text-dim text-xs max-w-[200px] truncate">{d.suggestedAction?.action}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {decisions.length === 0 && (
        <div className="bg-card border border-border rounded-2xl p-10 text-center card-elevated">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-gold/15 to-purple/15 flex items-center justify-center">
            <span className="text-3xl">🧠</span>
          </div>
          <p className="text-base font-medium mb-1">אין החלטות ממתינות</p>
          <p className="text-sm text-text-dim mb-4">הפעל Hot Check או Performance Check כדי ליצור החלטות חדשות</p>
        </div>
      )}

      {/* Daily Timeline */}
      {scheduleItems.length > 0 && (
        <div className="bg-card border border-border rounded-xl p-5 card-elevated accent-purple">
          <h3 className="text-xs font-medium text-text-dim mb-4">ציר זמן יומי</h3>
          <div className="relative pr-6">
            {/* Vertical line */}
            <div className="timeline-connector right-[11px]" />
            <div className="space-y-0">
              {scheduleItems.map((item, i) => (
                <div key={item.key} className="relative flex items-start gap-3 pb-4">
                  {/* Dot */}
                  <div className="absolute right-[-13px] top-1 z-10">
                    {item.status === 'done' ? (
                      <div className="w-5 h-5 rounded-full bg-green/20 flex items-center justify-center">
                        <svg width="10" height="10" viewBox="0 0 16 16" fill="none"><path d="M3 8l4 4 6-7" stroke="#22c55e" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                      </div>
                    ) : item.status === 'running' ? (
                      <div className="w-5 h-5 rounded-full bg-orange/20 flex items-center justify-center">
                        <div className="w-2.5 h-2.5 rounded-full bg-orange animate-pulse" />
                      </div>
                    ) : (
                      <div className="w-5 h-5 rounded-full bg-bg-elevated border border-border flex items-center justify-center">
                        <div className="w-2 h-2 rounded-full bg-text-dim/40" />
                      </div>
                    )}
                  </div>
                  {/* Card */}
                  <div className={`flex-1 bg-bg rounded-xl p-3 border transition-colors ${
                    item.status === 'running' ? 'border-orange/30 bg-orange/5' :
                    item.status === 'done' ? 'border-green/20' : 'border-border/50'
                  }`}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-sm">{item.icon}</span>
                        <span className="text-sm font-medium">{item.label}</span>
                      </div>
                      <span className="text-[10px] font-mono text-text-dim bg-bg-elevated/80 px-2 py-0.5 rounded-full">{item.time}</span>
                    </div>
                    {item.lastRun && (
                      <p className="text-[10px] text-text-dim mt-1">הרצה אחרונה: {relativeTime(item.lastRun)}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
          {/* Budget Defaults */}
          {config && (
            <div className="mt-4 pt-4 border-t border-border flex flex-wrap gap-4">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-pink" />
                <span className="text-xs text-text-dim">תקציב בסיסי: <span className="text-text font-medium">₪{config.budgetDefaults.baseDailyBudget}</span></span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-orange" />
                <span className="text-xs text-text-dim">Hot: <span className="text-text font-medium">x{config.budgetDefaults.hotEventMultiplier}</span></span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-red" />
                <span className="text-xs text-text-dim">On Fire: <span className="text-text font-medium">x{config.budgetDefaults.onFireMultiplier}</span></span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-purple" />
                <span className="text-xs text-text-dim">מטבע: <span className="text-text font-medium">{config.budgetDefaults.currency}</span></span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Quick Actions */}
      <div className="bg-card border border-border rounded-xl p-5 accent-green card-elevated">
        <h3 className="text-xs font-medium text-text-dim mb-4">פעולות מהירות</h3>
        <div className="grid grid-cols-2 gap-3 stat-grid-responsive">
          <button
            className="flex items-center gap-3 bg-bg rounded-xl p-4 border border-border/50 hover:border-orange/30 hover:bg-orange/5 transition-all cursor-pointer text-right disabled:opacity-50"
            onClick={() => handleTrigger('scan', triggerScan, 'סריקת מודיעין')}
            disabled={triggering === 'scan'}
          >
            <span className="w-10 h-10 rounded-xl bg-gradient-to-br from-orange/20 to-pink/20 flex items-center justify-center text-lg shrink-0">🕵️</span>
            <div>
              <p className="text-sm font-medium">{triggering === 'scan' ? 'סורק...' : 'הפעל סריקת מודיעין'}</p>
              <p className="text-[10px] text-text-dim">POST /api/intelligence/scan</p>
            </div>
          </button>

          <button
            className="flex items-center gap-3 bg-bg rounded-xl p-4 border border-border/50 hover:border-pink/30 hover:bg-pink/5 transition-all cursor-pointer text-right disabled:opacity-50"
            onClick={() => handleTrigger('hot', triggerHotCheck, 'Hot Check')}
            disabled={triggering === 'hot'}
          >
            <span className="w-10 h-10 rounded-xl bg-gradient-to-br from-pink/20 to-purple/20 flex items-center justify-center text-lg shrink-0">🔥</span>
            <div>
              <p className="text-sm font-medium">{triggering === 'hot' ? 'מריץ...' : 'הפעל Hot Check'}</p>
              <p className="text-[10px] text-text-dim">POST /api/orchestrator/hot-check</p>
            </div>
          </button>

          <button
            className="flex items-center gap-3 bg-bg rounded-xl p-4 border border-border/50 hover:border-purple/30 hover:bg-purple/5 transition-all cursor-pointer text-right disabled:opacity-50"
            onClick={() => handleTrigger('perf', triggerPerfCheck, 'בדיקת ביצועים')}
            disabled={triggering === 'perf'}
          >
            <span className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple/20 to-blue/20 flex items-center justify-center text-lg shrink-0">📊</span>
            <div>
              <p className="text-sm font-medium">{triggering === 'perf' ? 'בודק...' : 'הפעל בדיקת ביצועים'}</p>
              <p className="text-[10px] text-text-dim">POST /api/orchestrator/perf-check</p>
            </div>
          </button>

          <button
            className="flex items-center gap-3 bg-bg rounded-xl p-4 border border-border/50 hover:border-green/30 hover:bg-green/5 transition-all cursor-pointer text-right disabled:opacity-50"
            onClick={() => handleTrigger('pipeline', () => runFullPipeline({ homeTeam: '', awayTeam: '' }), 'Pipeline מלא')}
            disabled={triggering === 'pipeline'}
          >
            <span className="w-10 h-10 rounded-xl bg-gradient-to-br from-green/20 to-blue/20 flex items-center justify-center text-lg shrink-0">⚡</span>
            <div>
              <p className="text-sm font-medium">{triggering === 'pipeline' ? 'מריץ...' : 'הפעל Pipeline מלא'}</p>
              <p className="text-[10px] text-text-dim">POST /api/orchestrator/full-pipeline</p>
            </div>
          </button>

          <button
            className="flex items-center gap-3 bg-bg rounded-xl p-4 border border-border/50 hover:border-gold/30 hover:bg-gold/5 transition-all cursor-pointer text-right"
            onClick={handleSetupBoard}
          >
            <span className="w-10 h-10 rounded-xl bg-gradient-to-br from-gold/20 to-orange/20 flex items-center justify-center text-lg shrink-0">📋</span>
            <div>
              <p className="text-sm font-medium">הגדר לוח Monday</p>
              <p className="text-[10px] text-text-dim">POST /api/orchestrator/setup-board</p>
            </div>
          </button>
        </div>
      </div>

      {/* Confirmation Dialog */}
      <Dialog
        open={confirmAction !== null}
        onOpenChange={(open) => { if (!open) setConfirmAction(null); }}
        title={confirmAction?.type === 'approve' ? 'אישור החלטה' : 'דחיית החלטה'}
        description={`האם ${confirmAction?.type === 'approve' ? 'לאשר' : 'לדחות'} את ההחלטה עבור ${confirmAction?.label || ''}?`}
        confirmLabel={acting ? 'מבצע...' : confirmAction?.type === 'approve' ? 'אשר' : 'דחה'}
        onConfirm={handleExecuteDecision}
      />

      <AgentChat agent="orchestrator" />
    </div>
  );
}
