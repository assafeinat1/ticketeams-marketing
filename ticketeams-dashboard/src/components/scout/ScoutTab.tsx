import { useState, useCallback } from 'react';
import { getProactiveScan, getDemandScore, triggerProactiveScan, pushToMonday } from '../../api/scout';
import type { ProactiveScanResult, DemandScoreResult, DemandSuggestion } from '../../types/api';
import { usePolling } from '../../hooks/usePolling';
import { useToast } from '../../hooks/useToast';
import StatCard from '../shared/StatCard';
import StatusBadge from '../shared/StatusBadge';
import GradientButton from '../shared/GradientButton';
import SkeletonLoader from '../shared/SkeletonLoader';
import Tooltip from '../ui/Tooltip';
import AgentChat from '../chat/AgentChat';

type PushState = Record<string, 'idle' | 'loading' | 'success' | 'error'>;

export default function ScoutTab() {
  const [scan, setScan] = useState<ProactiveScanResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [pushStates, setPushStates] = useState<PushState>({});
  const { showToast } = useToast();

  // Quick demand check
  const [home, setHome] = useState('');
  const [away, setAway] = useState('');
  const [quickResult, setQuickResult] = useState<DemandScoreResult | null>(null);

  const loadScan = useCallback(async () => {
    try {
      const data = await getProactiveScan();
      setScan(data);
    } catch {
      // Backend may not be running
    } finally {
      setLoading(false);
    }
  }, []);

  usePolling(loadScan, 60000);

  const handleTriggerScan = async () => {
    setScanning(true);
    try {
      await triggerProactiveScan();
      showToast('info', 'סריקה פרואקטיבית התחילה — תוצאות יעודכנו בקרוב');
      setTimeout(loadScan, 3000);
    } finally {
      setScanning(false);
    }
  };

  const handleQuickCheck = async () => {
    if (!home || !away) return;
    try {
      const result = await getDemandScore(home, away);
      setQuickResult(result);
    } catch {
      setQuickResult(null);
    }
  };

  const handlePushToMonday = async (s: DemandSuggestion) => {
    setPushStates((prev) => ({ ...prev, [s.matchKey]: 'loading' }));
    try {
      await pushToMonday({
        matchKey: s.matchKey,
        homeTeam: s.homeTeam,
        awayTeam: s.awayTeam,
        competition: s.competition,
        date: s.date || '',
      });
      setPushStates((prev) => ({ ...prev, [s.matchKey]: 'success' }));
      showToast('success', `${s.homeTeam} vs ${s.awayTeam} נוסף ל-Monday.com`);
      setTimeout(() => {
        setPushStates((prev) => ({ ...prev, [s.matchKey]: 'idle' }));
      }, 3000);
    } catch {
      setPushStates((prev) => ({ ...prev, [s.matchKey]: 'error' }));
      showToast('error', 'שגיאה בדחיפה ל-Monday.com');
      setTimeout(() => {
        setPushStates((prev) => ({ ...prev, [s.matchKey]: 'idle' }));
      }, 3000);
    }
  };

  if (loading) return (
    <div className="space-y-5">
      <div className="skeleton h-6 w-48" />
      <SkeletonLoader type="cards" cols={3} />
      <SkeletonLoader type="table" rows={4} />
    </div>
  );

  const criticalCount = scan?.suggestions.filter(s => s.demandTier === 'critical').length || 0;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold">סקאוט — ביקוש פרואקטיבי</h2>
        <GradientButton onClick={handleTriggerScan} disabled={scanning}>
          {scanning ? (
            <span className="flex items-center gap-2">
              <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              סורק...
            </span>
          ) : 'הפעל סריקה'}
        </GradientButton>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3 stat-grid-responsive">
        <StatCard label="משחקים שנמצאו" value={scan?.totalFixtures || 0} color="purple" />
        <StatCard label="ביקוש גבוה" value={scan?.highDemand || 0} color="orange" />
        <StatCard label="קריטי" value={criticalCount} color="red" />
      </div>

      {/* Quick Demand Check */}
      <div className="bg-card border border-border rounded-xl p-5 accent-green card-elevated">
        <h3 className="text-xs font-medium text-text-dim mb-3">בדיקת ביקוש מהירה</h3>
        <div className="flex gap-3 items-end">
          <div className="flex-1">
            <label className="block text-xs text-text-dim mb-1">קבוצת בית</label>
            <input
              value={home}
              onChange={(e) => setHome(e.target.value)}
              placeholder="Arsenal"
              className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-sm text-text focus:border-pink focus:outline-none"
            />
          </div>
          <div className="flex-1">
            <label className="block text-xs text-text-dim mb-1">קבוצת חוץ</label>
            <input
              value={away}
              onChange={(e) => setAway(e.target.value)}
              placeholder="Chelsea"
              className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-sm text-text focus:border-pink focus:outline-none"
            />
          </div>
          <GradientButton onClick={handleQuickCheck} variant="ghost">
            בדוק
          </GradientButton>
        </div>

        {quickResult && (
          <div className="mt-4 flex items-center gap-4 bg-bg rounded-lg p-3">
            <span className="text-2xl font-bold text-pink">{quickResult.score}</span>
            <span className="text-text-dim">/100</span>
            <StatusBadge status={quickResult.tier} size="md" />
            <span className="text-xs text-text-dim">
              {quickResult.factors.join(' | ')}
            </span>
          </div>
        )}
      </div>

      {/* Suggestions Table */}
      {scan?.suggestions && scan.suggestions.length > 0 && (
        <div className="bg-card border border-border rounded-xl overflow-hidden card-elevated overflow-x-auto">
          <table className="w-full text-sm min-w-[700px]">
            <thead>
              <tr className="border-b border-border text-text-dim text-right bg-bg-elevated/50">
                <th className="px-4 py-3.5 font-semibold text-xs uppercase tracking-wide">משחק</th>
                <th className="px-4 py-3.5 font-semibold text-xs uppercase tracking-wide">תחרות</th>
                <th className="px-4 py-3.5 font-semibold text-xs uppercase tracking-wide">תאריך</th>
                <th className="px-4 py-3.5 font-semibold text-xs uppercase tracking-wide">ציון</th>
                <th className="px-4 py-3.5 font-semibold text-xs uppercase tracking-wide">דרגה</th>
                <th className="px-4 py-3.5 font-semibold text-xs uppercase tracking-wide">סיבה</th>
                <th className="px-4 py-3.5 font-semibold text-xs uppercase tracking-wide">פעולה</th>
              </tr>
            </thead>
            <tbody>
              {scan.suggestions.map((s) => {
                const state = pushStates[s.matchKey] || 'idle';
                return (
                  <tr key={s.matchKey} className="border-b border-border/50 hover:bg-card-hover transition-colors">
                    <td className="px-4 py-3 font-medium">{s.homeTeam} vs {s.awayTeam}</td>
                    <td className="px-4 py-3 text-text-dim">{s.competition}</td>
                    <td className="px-4 py-3 text-text-dim">{s.date || '—'}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-16 h-2 bg-bg rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full bg-gradient-to-l from-pink to-orange"
                            style={{ width: `${s.demandScore}%` }}
                          />
                        </div>
                        <span className="text-xs font-medium">{s.demandScore}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3"><StatusBadge status={s.demandTier} /></td>
                    <td className="px-4 py-3 text-xs text-text-dim">{s.reason}</td>
                    <td className="px-4 py-3">
                      {(s.demandTier === 'critical' || s.demandTier === 'high') && (
                        <Tooltip content="צור פריט חדש ב-Monday.com">
                          <button
                            onClick={() => handlePushToMonday(s)}
                            disabled={state === 'loading' || state === 'success'}
                            className="text-xs px-3 py-1.5 rounded-lg font-medium transition-all cursor-pointer disabled:cursor-not-allowed whitespace-nowrap"
                            style={{
                              background: state === 'success' ? 'rgba(34,197,94,0.15)' : 'rgba(233,30,140,0.1)',
                              color: state === 'success' ? '#22c55e' : state === 'error' ? '#ef4444' : '#E91E8C',
                              border: `1px solid ${state === 'success' ? 'rgba(34,197,94,0.3)' : 'rgba(233,30,140,0.2)'}`,
                            }}
                          >
                            {state === 'loading' && (
                              <span className="inline-flex items-center gap-1">
                                <span className="w-3 h-3 border-2 border-pink/30 border-t-pink rounded-full animate-spin" />
                                שולח...
                              </span>
                            )}
                            {state === 'success' && '✓ נוסף'}
                            {state === 'error' && 'שגיאה'}
                            {state === 'idle' && 'דחוף ל-Monday'}
                          </button>
                        </Tooltip>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {scan?.suggestions?.length === 0 && (
        <div className="bg-card border border-border rounded-2xl p-10 text-center card-elevated">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-green/15 to-blue/15 flex items-center justify-center">
            <span className="text-3xl">📡</span>
          </div>
          <p className="text-base font-medium mb-1">אין הצעות חדשות</p>
          <p className="text-sm text-text-dim mb-4">הפעל סריקה פרואקטיבית לגילוי הזדמנויות</p>
          <GradientButton onClick={handleTriggerScan} disabled={scanning}>
            {scanning ? 'סורק...' : 'הפעל סריקה'}
          </GradientButton>
        </div>
      )}

      <AgentChat agent="scout" />
    </div>
  );
}
