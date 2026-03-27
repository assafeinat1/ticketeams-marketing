import { useState, useCallback, useEffect } from 'react';
import { getAdMonitor, triggerAdMonitor, triggerRimaCampaign, getCompetitorAds } from '../../api/meta';
import { getPendingApprovals } from '../../api/creative';
import type { AdMonitorResult, PendingApproval, CompetitorAdResult } from '../../types/api';
import { useToast } from '../../hooks/useToast';
import StatCard from '../shared/StatCard';
import StatusBadge from '../shared/StatusBadge';
import GradientButton from '../shared/GradientButton';
import LoadingSpinner from '../shared/LoadingSpinner';
import AdPreviewCard from './AdPreviewCard';
import PublishToggle from './PublishToggle';
import CompetitorAdGrid from './CompetitorAdGrid';
import AgentChat from '../chat/AgentChat';

export default function MetaTab() {
  const today = new Date().toISOString().split('T')[0];
  const [date, setDate] = useState(today);
  const [monitor, setMonitor] = useState<AdMonitorResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [rimaTriggered, setRimaTriggered] = useState(false);
  const [error, setError] = useState('');
  const [approvedAds, setApprovedAds] = useState<PendingApproval[]>([]);
  const [competitorResult, setCompetitorResult] = useState<CompetitorAdResult | null>(null);
  const [competitorLoading, setCompetitorLoading] = useState(false);
  const [searchInput, setSearchInput] = useState('');
  const { showToast } = useToast();

  // Load approved ads for preview
  useEffect(() => {
    getPendingApprovals()
      .then((data) => setApprovedAds(data.filter((a) => a.status === 'אושר')))
      .catch(() => {});
  }, []);

  const loadMonitor = useCallback(async (targetDate: string) => {
    setLoading(true);
    setError('');
    try {
      const data = await getAdMonitor(targetDate);
      setMonitor(data);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'שגיאה בטעינת דוח';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleScan = async () => {
    setScanning(true);
    try {
      await triggerAdMonitor(date);
      showToast('info', 'סריקת מתחרים התחילה — תוצאות יעודכנו בעוד מספר שניות');
      setTimeout(() => loadMonitor(date), 5000);
    } finally {
      setScanning(false);
    }
  };

  const handleRima = async () => {
    try {
      await triggerRimaCampaign();
      setRimaTriggered(true);
      showToast('success', 'Rima Campaign הופעלה');
      setTimeout(() => setRimaTriggered(false), 5000);
    } catch {
      showToast('error', 'שגיאה בהפעלת Rima');
    }
  };

  const handleCompetitorSearch = async () => {
    setCompetitorLoading(true);
    try {
      const terms = searchInput.trim()
        ? searchInput.split(',').map((s) => s.trim()).filter(Boolean)
        : undefined;
      const result = await getCompetitorAds(terms);
      setCompetitorResult(result);
      showToast('success', `נמצאו ${result.totalAds} פרסומות מתחרים`);
    } catch {
      showToast('error', 'שגיאה בחיפוש פרסומות מתחרים');
    } finally {
      setCompetitorLoading(false);
    }
  };

  return (
    <div className="space-y-5">
      <h2 className="text-lg font-bold">Meta Publisher — ניטור ופרסום</h2>

      {/* Approved Ad Previews */}
      {approvedAds.length > 0 && (
        <div className="space-y-4">
          <h3 className="text-sm font-medium text-text-dim">מודעות מאושרות — תצוגה מקדימה</h3>
          {approvedAds.map((ad) => {
            const selectedVersion = ad.versions.find((v) => v.index === ad.selectedVersion);
            const matchName = ad.matchKey.replace(/__/g, ' | ').replace(/_/g, ' ');
            if (!selectedVersion) return null;
            return (
              <div key={ad.matchKey} className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="font-medium text-sm">{matchName}</h4>
                  <StatusBadge status="approved" size="md" />
                </div>
                <AdPreviewCard version={selectedVersion} matchName={matchName} />
                <PublishToggle matchKey={ad.matchKey} />
              </div>
            );
          })}
        </div>
      )}

      {/* Controls */}
      <div className="flex items-end gap-4">
        <div>
          <label className="block text-xs text-text-dim mb-1">תאריך</label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="bg-bg border border-border rounded-lg px-3 py-2 text-sm text-text focus:border-pink focus:outline-none"
          />
        </div>
        <GradientButton onClick={() => loadMonitor(date)} disabled={loading}>
          {loading ? 'טוען...' : 'טען דוח'}
        </GradientButton>
        <GradientButton onClick={handleScan} variant="ghost" disabled={scanning}>
          {scanning ? (
            <span className="flex items-center gap-2">
              <span className="w-3 h-3 border-2 border-text-dim/30 border-t-text-dim rounded-full animate-spin" />
              סורק...
            </span>
          ) : 'סרוק מתחרים'}
        </GradientButton>
        <GradientButton onClick={handleRima} variant="ghost" disabled={rimaTriggered}>
          {rimaTriggered ? 'Rima הופעלה ✓' : 'הפעל Rima Campaign'}
        </GradientButton>
      </div>

      {loading && <LoadingSpinner text="טוען נתוני מתחרים..." />}

      {error && (
        <div className="bg-red/10 border border-red/30 rounded-xl p-4 text-sm text-red">{error}</div>
      )}

      {monitor && !loading && (
        <>
          {/* Summary Stats */}
          <div className="grid grid-cols-4 gap-3 stat-grid-responsive">
            <StatCard label="סה״כ פרסומות" value={monitor.totalAds} color="purple" />
            <StatCard label="Stadium" value={monitor.summary.stadium} color="pink" />
            <StatCard label="Human" value={monitor.summary.human} color="orange" />
            <StatCard label="Urgency" value={monitor.summary.urgency} color="red" />
          </div>

          {/* Counter-Ad Candidates */}
          {monitor.counterAdCandidates.length > 0 && (
            <div className="bg-orange/10 border border-orange/30 rounded-xl p-5">
              <h3 className="font-bold text-sm text-orange mb-3">מועמדים לפרסומת נגדית</h3>
              {monitor.counterAdCandidates.map((c, i) => (
                <div key={i} className="flex items-center gap-3 text-sm py-1">
                  <StatusBadge status={c.format_type} />
                  <span>{c.homeTeam} vs {c.awayTeam}</span>
                  <span className="text-text-dim">({c.competitor})</span>
                </div>
              ))}
            </div>
          )}

          {/* Competitor Sections */}
          {monitor.competitors.map((comp) => (
            <div key={comp.page_name} className="bg-card border border-border rounded-xl overflow-hidden">
              <div className="px-5 py-3 border-b border-border flex items-center justify-between">
                <h3 className="font-bold">{comp.page_name}</h3>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-text-dim">{comp.ads_count} פרסומות</span>
                  <StatusBadge status={comp.status === 'ok' ? 'approved' : comp.status} />
                </div>
              </div>

              {comp.ads.length > 0 ? (
                <div className="divide-y divide-border/50">
                  {comp.ads.map((ad, i) => (
                    <div key={i} className="px-5 py-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-2">
                            <StatusBadge status={ad.classification.format_type} />
                            {ad.match_info.matched && (
                              <span className="text-xs text-green">
                                {ad.match_info.homeTeam} vs {ad.match_info.awayTeam}
                              </span>
                            )}
                          </div>
                          {ad.title && <p className="text-sm font-medium mb-1">{ad.title}</p>}
                          <p className="text-xs text-text-dim line-clamp-2">{ad.body}</p>
                        </div>
                        <span className="text-xs text-text-dim whitespace-nowrap">{ad.delivery_start}</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="px-5 py-4 text-sm text-text-dim">
                  {comp.status === 'ok' ? 'אין פרסומות פעילות' : comp.status}
                </p>
              )}
            </div>
          ))}
        </>
      )}

      {/* Competitor Ad Library Search */}
      <div className="bg-card border border-border rounded-xl p-5 space-y-4 accent-blue card-elevated">
        <h3 className="text-xs font-bold">Ad Monitor — חיפוש פרסומות מתחרים</h3>
        <div className="flex items-end gap-3">
          <div className="flex-1">
            <label className="block text-xs text-text-dim mb-1">
              מונחי חיפוש (מופרדים בפסיקים, או השאר ריק לברירת מחדל)
            </label>
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !competitorLoading && handleCompetitorSearch()}
              placeholder="כרטיסים כדורגל, football tickets israel..."
              className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-sm text-text focus:border-pink focus:outline-none"
            />
          </div>
          <GradientButton onClick={handleCompetitorSearch} disabled={competitorLoading}>
            {competitorLoading ? (
              <span className="flex items-center gap-2">
                <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                סורק Ad Library...
              </span>
            ) : 'סרוק פרסומות'}
          </GradientButton>
        </div>

        {competitorLoading && <LoadingSpinner text="מחפש פרסומות מתחרים ב-Meta Ad Library..." />}

        {competitorResult && !competitorLoading && (
          <CompetitorAdGrid ads={competitorResult.ads} scannedAt={competitorResult.scannedAt} sources={competitorResult.sources} apiBlindCompetitors={competitorResult.apiBlindCompetitors} />
        )}
      </div>

      {!monitor && !loading && !error && !competitorResult && approvedAds.length === 0 && (
        <div className="bg-card border border-border rounded-2xl p-10 text-center card-elevated">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-blue/15 to-purple/15 flex items-center justify-center">
            <span className="text-3xl">🚀</span>
          </div>
          <p className="text-base font-medium mb-1">אין נתונים עדיין</p>
          <p className="text-sm text-text-dim">בחר תאריך ולחץ "טען דוח" לצפייה בפרסומות המתחרים</p>
        </div>
      )}

      <AgentChat agent="meta" />
    </div>
  );
}
