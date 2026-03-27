import { useState, useCallback, useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { getHeatScores, getDailyReport, triggerScan, sendReport } from '../../api/intelligence';
import type { ScoredEvent, IntelligenceReport } from '../../types/api';
import { usePolling } from '../../hooks/usePolling';
import { useToast } from '../../hooks/useToast';
import { useTheme } from '../../context/ThemeContext';
import StatCard from '../shared/StatCard';
import StatusBadge from '../shared/StatusBadge';
import GradientButton from '../shared/GradientButton';
import SkeletonLoader from '../shared/SkeletonLoader';
import AgentChat from '../chat/AgentChat';

const TIER_COLORS: Record<string, string> = {
  onFire: '#E91E8C',
  hot: '#FF6B35',
  warm: '#7B2D8B',
  cold: '#555',
};

export default function IntelligenceTab() {
  const [events, setEvents] = useState<ScoredEvent[]>([]);
  const [report, setReport] = useState<IntelligenceReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [sending, setSending] = useState(false);
  const { showToast } = useToast();
  const { theme } = useTheme();

  const loadData = useCallback(async () => {
    try {
      const today = new Date().toISOString().split('T')[0];
      const [heatRes, reportRes] = await Promise.allSettled([
        getHeatScores(),
        getDailyReport(today),
      ]);
      if (heatRes.status === 'fulfilled') setEvents(heatRes.value);
      if (reportRes.status === 'fulfilled') setReport(reportRes.value);
    } catch {
      // Backend may not be running
    } finally {
      setLoading(false);
    }
  }, []);

  usePolling(loadData, 120000);

  const handleScan = async () => {
    setScanning(true);
    try {
      await triggerScan();
      showToast('success', 'סריקת מודיעין הופעלה ברקע');
      setTimeout(loadData, 5000);
    } catch {
      showToast('error', 'שגיאה בהפעלת סריקה');
    } finally {
      setScanning(false);
    }
  };

  const handleSendReport = async () => {
    setSending(true);
    try {
      await sendReport();
      showToast('success', 'דוח מודיעין נשלח');
    } catch {
      showToast('error', 'שגיאה בשליחת דוח');
    } finally {
      setSending(false);
    }
  };

  // Filter to future events only
  const futureEvents = useMemo(() => {
    const today = new Date().toISOString().split('T')[0];
    return events.filter(e => { const d = e.eventDate || e.date; return !d || d >= today; });
  }, [events]);

  if (loading) return (
    <div className="space-y-5">
      <div className="skeleton h-6 w-56" />
      <SkeletonLoader type="cards" />
      <SkeletonLoader type="chart" />
      <SkeletonLoader type="table" rows={5} />
    </div>
  );

  const sorted = [...futureEvents].sort((a, b) => b.score - a.score);
  const onFireCount = futureEvents.filter(e => e.tier === 'onFire').length;
  const hotCount = futureEvents.filter(e => e.tier === 'hot').length;
  const totalSources = report?.sources ? Object.keys(report.sources).length : 0;

  const chartData = sorted.map(e => ({
    name: `${e.homeTeam} vs ${e.awayTeam}`,
    score: e.score,
    tier: e.tier,
  }));

  // Theme-aware chart colors
  const gridStroke = theme === 'dark' ? '#222' : '#E0E0E0';
  const tickFill = theme === 'dark' ? '#888' : '#6B6B6B';
  const tooltipBg = theme === 'dark' ? '#111' : '#FFFFFF';
  const tooltipBorder = theme === 'dark' ? '#222' : '#E0E0E0';
  const tooltipColor = theme === 'dark' ? '#f0f0f0' : '#1A1A1A';

  return (
    <div className="space-y-5">
      <h2 className="text-lg font-bold">מודיעין — Heat Score Dashboard</h2>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3 stat-grid-responsive">
        <StatCard label="אירועים עתידיים" value={futureEvents.length} color="purple" />
        <StatCard label="On Fire" value={onFireCount} color="pink" pulse={onFireCount > 0} />
        <StatCard label="Hot" value={hotCount} color="orange" />
        <StatCard label="מקורות פעילים" value={totalSources} color="green" />
      </div>

      {/* Heat Score Chart */}
      {chartData.length > 0 && (
        <div className="bg-card border border-border rounded-xl p-5 accent-purple card-elevated">
          <h3 className="text-xs font-medium text-text-dim mb-4">Heat Scores — אירועים עתידיים</h3>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={chartData} layout="vertical" margin={{ left: 120 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
              <XAxis type="number" domain={[0, 100]} tick={{ fill: tickFill, fontSize: 11 }} />
              <YAxis type="category" dataKey="name" tick={{ fill: tickFill, fontSize: 11 }} width={120} />
              <Tooltip
                contentStyle={{ background: tooltipBg, border: `1px solid ${tooltipBorder}`, borderRadius: 12, color: tooltipColor, padding: '10px 14px', boxShadow: '0 4px 12px rgba(0,0,0,0.15)' }}
                labelStyle={{ fontWeight: 600, marginBottom: 4, fontSize: 13 }}
                formatter={(value: number, _name: string, props: { payload: { tier: string } }) => [
                  `${value}/100 — ${props.payload.tier === 'onFire' ? '🔥 On Fire' : props.payload.tier === 'hot' ? '🌡️ Hot' : props.payload.tier === 'warm' ? '☁️ Warm' : '❄️ Cold'}`,
                  'Heat Score'
                ]}
              />
              <Bar dataKey="score" radius={[0, 4, 4, 0]} animationDuration={800} animationEasing="ease-out">
                {chartData.map((entry, i) => (
                  <Cell key={i} fill={TIER_COLORS[entry.tier] || '#555'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Event Table */}
      {sorted.length > 0 && (
        <div className="bg-card border border-border rounded-xl p-5 accent-pink card-elevated">
          <h3 className="text-xs font-medium text-text-dim mb-4">פירוט אירועים</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-text-dim bg-bg-elevated/50">
                  <th className="text-right py-3 px-3 font-semibold text-xs uppercase tracking-wide">אירוע</th>
                  <th className="text-right py-3 px-3 font-semibold text-xs uppercase tracking-wide">תחרות</th>
                  <th className="text-right py-3 px-3 font-semibold text-xs uppercase tracking-wide">תאריך</th>
                  <th className="text-right py-3 px-3 font-semibold text-xs uppercase tracking-wide">Score</th>
                  <th className="text-right py-3 px-3 font-semibold text-xs uppercase tracking-wide">דרגה</th>
                  <th className="text-right py-3 px-3 font-semibold text-xs uppercase tracking-wide">מקורות</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((event, i) => (
                  <tr key={i} className={`border-b border-border/50 hover:bg-card-hover transition-colors ${event.tier === 'onFire' ? 'on-fire-row' : ''}`}>
                    <td className="py-2.5 px-3 font-medium">
                      <span className="flex items-center gap-1.5">
                        {event.tier === 'onFire' && <span className="text-xs">🔥</span>}
                        {event.homeTeam} vs {event.awayTeam}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-text-dim">{event.competition || '—'}</td>
                    <td className="py-2.5 px-3 text-text-dim">{event.eventDate || event.date || '—'}</td>
                    <td className="py-2.5 px-3">
                      <div className="flex items-center gap-2">
                        <div className="w-16 h-2 bg-bg rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all duration-700"
                            style={{ width: `${event.score}%`, backgroundColor: TIER_COLORS[event.tier] || '#555' }}
                          />
                        </div>
                        <span className="text-xs font-bold" style={{ color: TIER_COLORS[event.tier] || '#888' }}>
                          {event.score}
                        </span>
                      </div>
                    </td>
                    <td className="py-2.5 px-3">
                      <StatusBadge status={event.tier === 'onFire' ? 'critical' : event.tier === 'hot' ? 'high' : 'medium'} />
                    </td>
                    <td className="py-2.5 px-3 text-text-dim">{Array.isArray(event.activeSources) ? event.activeSources.join(', ') : event.activeSources}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {futureEvents.length === 0 && (
        <div className="bg-card border border-border rounded-2xl p-10 text-center card-elevated">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-purple/15 to-pink/15 flex items-center justify-center">
            <span className="text-3xl">🕵️</span>
          </div>
          <p className="text-base font-medium mb-1">אין נתוני מודיעין</p>
          <p className="text-sm text-text-dim mb-4">הפעל סריקה לקבלת Heat Scores</p>
          <GradientButton onClick={handleScan} disabled={scanning}>
            {scanning ? 'סורק...' : 'הפעל סריקה'}
          </GradientButton>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-3">
        <GradientButton onClick={handleScan} disabled={scanning}>
          {scanning ? 'סורק...' : 'הפעל סריקה'}
        </GradientButton>
        <GradientButton variant="ghost" onClick={handleSendReport} disabled={sending}>
          {sending ? 'שולח...' : 'שלח דוח'}
        </GradientButton>
      </div>

      <AgentChat agent="intelligence" />
    </div>
  );
}
