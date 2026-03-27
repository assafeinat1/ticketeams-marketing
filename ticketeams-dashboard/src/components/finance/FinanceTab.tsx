import { useState, useCallback } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { getWeeklyReport, sendFinanceReport } from '../../api/finance';
import type { WeeklyFinanceReport } from '../../types/api';
import { usePolling } from '../../hooks/usePolling';
import { useToast } from '../../hooks/useToast';
import { useTheme } from '../../context/ThemeContext';
import StatCard from '../shared/StatCard';
import StatusBadge from '../shared/StatusBadge';
import GradientButton from '../shared/GradientButton';
import SkeletonLoader from '../shared/SkeletonLoader';
import AgentChat from '../chat/AgentChat';

function getWeekStart(): string {
  const now = new Date();
  const day = now.getDay();
  const diff = day === 0 ? 0 : day;
  const sunday = new Date(now);
  sunday.setDate(now.getDate() - diff);
  return sunday.toISOString().split('T')[0];
}

function roasColor(roas: number | null): string {
  if (roas === null) return 'text-text-dim';
  if (roas < 1.0) return 'text-red';
  if (roas < 1.5) return 'text-orange';
  if (roas >= 5.0) return 'text-green';
  return 'text-text';
}

function formatCurrency(value: number): string {
  return `₪${value.toLocaleString('he-IL')}`;
}

export default function FinanceTab() {
  const [report, setReport] = useState<WeeklyFinanceReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const { showToast } = useToast();

  const loadData = useCallback(async () => {
    try {
      const weekStart = getWeekStart();
      const data = await getWeeklyReport(weekStart);
      setReport(data);
    } catch {
      // Backend may not be running or timed out
    } finally {
      setLoading(false);
    }
  }, []);

  usePolling(loadData, 120000);
  const { theme } = useTheme();

  // Theme-aware chart colors
  const gridStroke = theme === 'dark' ? '#222' : '#E0E0E0';
  const tickFill = theme === 'dark' ? '#888' : '#6B6B6B';
  const tooltipBg = theme === 'dark' ? '#111' : '#FFFFFF';
  const tooltipBorder = theme === 'dark' ? '#222' : '#E0E0E0';
  const tooltipColor = theme === 'dark' ? '#f0f0f0' : '#1A1A1A';

  const handleSendReport = async () => {
    setSending(true);
    try {
      await sendFinanceReport();
      showToast('success', 'דוח פיננסי נשלח');
    } catch {
      showToast('error', 'שגיאה בשליחת דוח פיננסי');
    } finally {
      setSending(false);
    }
  };

  if (loading) return (
    <div className="space-y-5">
      <div className="skeleton h-6 w-52" />
      <SkeletonLoader type="cards" />
      <SkeletonLoader type="table" rows={5} />
      <SkeletonLoader type="chart" />
    </div>
  );

  const exec = report?.executiveSummary;
  const campaigns = report?.campaignPerformance || [];
  const channels = report?.channelPerformance || [];
  const alerts = report?.alerts || [];
  const budgetRecs = report?.budgetRecommendations || [];

  const channelData = channels.map(c => ({
    name: c.channelLabel || c.channel,
    revenue: c.totalRevenue,
  }));

  return (
    <div className="space-y-5">
      <h2 className="text-lg font-bold">פיננסים — ROAS & Profitability</h2>

      {/* Stats */}
      {exec && (
        <div className="grid grid-cols-4 gap-3 stat-grid-responsive">
          <StatCard label="הכנסות (כל הזמנים)" value={formatCurrency(exec.allTimeTotalRevenue)} color="green" />
          <StatCard label="עסקאות" value={exec.allTimeDealCount.toLocaleString('he-IL')} color="purple" />
          <StatCard label="הכנסות השבוע" value={formatCurrency(exec.totalRevenue)} color="pink" />
          <StatCard label="עסקאות השבוע" value={exec.dealCount} color="orange" />
        </div>
      )}

      {/* Campaign ROAS Table */}
      {campaigns.length > 0 && (
        <div className="bg-card border border-border rounded-xl p-5 accent-pink card-elevated">
          <h3 className="text-xs font-medium text-text-dim mb-4">ביצועי קמפיינים ({campaigns.length})</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-text-dim bg-bg-elevated/50">
                  <th className="text-right py-3 px-3 font-semibold text-xs uppercase tracking-wide">קמפיין</th>
                  <th className="text-right py-3 px-3 font-semibold text-xs uppercase tracking-wide">הוצאות</th>
                  <th className="text-right py-3 px-3 font-semibold text-xs uppercase tracking-wide">הכנסות</th>
                  <th className="text-right py-3 px-3 font-semibold text-xs uppercase tracking-wide">רווח</th>
                  <th className="text-right py-3 px-3 font-semibold text-xs uppercase tracking-wide">ROAS</th>
                  <th className="text-right py-3 px-3 font-semibold text-xs uppercase tracking-wide">עסקאות</th>
                </tr>
              </thead>
              <tbody>
                {campaigns.map((c, i) => (
                  <tr key={i} className="border-b border-border/50 hover:bg-card-hover transition-colors">
                    <td className="py-2 font-medium">{c.campaignName}</td>
                    <td className="py-2 text-text-dim">{formatCurrency(c.adSpend)}</td>
                    <td className="py-2 text-text-dim">{formatCurrency(c.totalRevenue)}</td>
                    <td className={`py-2 font-medium ${c.totalProfit >= 0 ? 'text-green' : 'text-red'}`}>
                      {formatCurrency(c.totalProfit)}
                    </td>
                    <td className="py-2">
                      {c.roas !== null ? (
                        <div className="flex items-center gap-2">
                          <div className="w-12 h-2 bg-bg rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full transition-all duration-700"
                              style={{
                                width: `${Math.min(c.roas / 5 * 100, 100)}%`,
                                backgroundColor: c.roas < 1 ? '#ef4444' : c.roas < 1.5 ? '#FF6B35' : c.roas >= 5 ? '#22c55e' : '#579BFC',
                              }}
                            />
                          </div>
                          <span className={`text-xs font-bold ${roasColor(c.roas)}`}>{c.roas.toFixed(1)}x</span>
                        </div>
                      ) : (
                        <span className="text-text-dim">—</span>
                      )}
                    </td>
                    <td className="py-2 text-text-dim">{c.dealCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Channels + Budget Recs — 2 columns */}
      <div className="grid grid-cols-2 gap-4">
        {/* Channel Performance Chart */}
        {channelData.length > 0 && (
          <div className="bg-card border border-border rounded-xl p-5 accent-green card-elevated">
            <h3 className="text-xs font-medium text-text-dim mb-4">הכנסות לפי ערוץ</h3>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={channelData}>
                <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
                <XAxis dataKey="name" tick={{ fill: tickFill, fontSize: 11 }} />
                <YAxis tick={{ fill: tickFill, fontSize: 11 }} />
                <Tooltip
                  contentStyle={{ background: tooltipBg, border: `1px solid ${tooltipBorder}`, borderRadius: 12, color: tooltipColor, padding: '10px 14px', boxShadow: '0 4px 12px rgba(0,0,0,0.15)' }}
                  formatter={(value: number) => [formatCurrency(value), 'הכנסות']}
                  labelStyle={{ fontWeight: 600, marginBottom: 4 }}
                />
                <Bar dataKey="revenue" fill="#E91E8C" radius={[4, 4, 0, 0]} animationDuration={800} animationEasing="ease-out" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Budget Recommendations */}
        {budgetRecs.length > 0 && (
          <div className="bg-card border border-border rounded-xl p-5 accent-orange card-elevated">
            <h3 className="text-xs font-medium text-text-dim mb-4">המלצות תקציב</h3>
            <div className="space-y-3 max-h-[250px] overflow-y-auto">
              {budgetRecs.map((rec, i) => (
                <div key={i} className="bg-bg border border-border rounded-lg px-4 py-3">
                  <div className="flex items-center gap-2 mb-2">
                    <StatusBadge
                      status={rec.recommendation === 'pause' ? 'critical' : rec.recommendation === 'reduce' ? 'high' : 'medium'}
                    />
                    <span className="text-sm font-medium truncate">{rec.campaignName}</span>
                  </div>
                  {rec.currentBudget != null && rec.suggestedBudget != null && (
                    <div className="flex items-center gap-2 mb-2 text-xs">
                      <span className="text-text-dim">{formatCurrency(rec.currentBudget)}</span>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={rec.suggestedBudget < rec.currentBudget ? 'text-red' : 'text-green'}>
                        <path d="M5 12h14M12 5l7 7-7 7" />
                      </svg>
                      <span className={`font-bold ${rec.suggestedBudget < rec.currentBudget ? 'text-red' : 'text-green'}`}>
                        {rec.recommendation === 'pause' ? 'השהייה' : formatCurrency(rec.suggestedBudget)}
                      </span>
                    </div>
                  )}
                  <p className="text-xs text-text-dim">{rec.reason}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Alerts */}
      {alerts.length > 0 && (
        <div className="bg-card border border-border rounded-xl p-5">
          <h3 className="text-sm font-medium text-text-dim mb-4">התראות ({alerts.length})</h3>
          <div className="space-y-2 max-h-[300px] overflow-y-auto">
            {alerts.map((alert, i) => (
              <div key={i} className="flex items-start gap-3 bg-bg border border-border rounded-lg px-4 py-3">
                <StatusBadge status={alert.severity} />
                <div>
                  <p className="text-sm">{alert.message}</p>
                  <p className="text-xs text-text-dim mt-1">{alert.type}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {!report && (
        <div className="bg-card border border-border rounded-2xl p-10 text-center card-elevated">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-pink/15 to-orange/15 flex items-center justify-center">
            <span className="text-3xl">💰</span>
          </div>
          <p className="text-base font-medium mb-1">אין נתונים פיננסיים</p>
          <p className="text-sm text-text-dim mb-4">הרץ דוח שבועי לקבלת נתונים</p>
          <GradientButton variant="ghost" onClick={handleSendReport} disabled={sending}>
            {sending ? 'שולח...' : 'שלח דוח פיננסי'}
          </GradientButton>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-3">
        <GradientButton variant="ghost" onClick={handleSendReport} disabled={sending}>
          {sending ? 'שולח...' : 'שלח דוח פיננסי'}
        </GradientButton>
      </div>

      <AgentChat agent="finance" />
    </div>
  );
}
