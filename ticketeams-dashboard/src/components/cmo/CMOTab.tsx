import { useState, useCallback } from 'react';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { getBIReport, getStockOverview } from '../../api/cmo';
import type { BIReport, StockData } from '../../types/api';
import { usePolling } from '../../hooks/usePolling';
import { useTheme } from '../../context/ThemeContext';
import StatCard from '../shared/StatCard';
import SkeletonLoader from '../shared/SkeletonLoader';
import BudgetSlider from './BudgetSlider';
import StockIndicator from './StockIndicator';
import AgentChat from '../chat/AgentChat';

export default function CMOTab() {
  const [report, setReport] = useState<BIReport | null>(null);
  const [stockOverview, setStockOverview] = useState<StockData[]>([]);
  const [loading, setLoading] = useState(true);

  const loadReport = useCallback(async () => {
    try {
      const [biData, stockData] = await Promise.allSettled([
        getBIReport(),
        getStockOverview(),
      ]);
      if (biData.status === 'fulfilled') setReport(biData.value);
      if (stockData.status === 'fulfilled') setStockOverview(stockData.value);
    } catch {
      // Backend may not be running
    } finally {
      setLoading(false);
    }
  }, []);

  usePolling(loadReport, 120000);
  const { theme } = useTheme();

  // Theme-aware chart colors
  const gridStroke = theme === 'dark' ? '#222' : '#E0E0E0';
  const tickFill = theme === 'dark' ? '#888' : '#6B6B6B';
  const tooltipBg = theme === 'dark' ? '#111' : '#FFFFFF';
  const tooltipBorder = theme === 'dark' ? '#222' : '#E0E0E0';
  const tooltipColor = theme === 'dark' ? '#f0f0f0' : '#1A1A1A';

  if (loading) return (
    <div className="space-y-5">
      <div className="skeleton h-6 w-44" />
      <SkeletonLoader type="cards" />
      <SkeletonLoader type="chart" />
      <SkeletonLoader type="text" rows={4} />
    </div>
  );
  if (!report) return (
    <div className="space-y-5">
      <h2 className="text-lg font-bold">אנליטיקס — BI Dashboard</h2>
      <div className="bg-card border border-border rounded-2xl p-10 text-center card-elevated">
        <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-blue/15 to-pink/15 flex items-center justify-center">
          <span className="text-3xl">📊</span>
        </div>
        <p className="text-base font-medium mb-1">לא ניתן לטעון דוח BI</p>
        <p className="text-sm text-text-dim">ודא שהשרת פעיל ונסה שוב</p>
      </div>
    </div>
  );

  // Transform data for charts
  const competitionData = Object.entries(report.byCompetition).map(([name, data]) => ({
    name: name === 'unknown' ? 'לא מסווג' : name,
    count: data.count,
    leadTime: data.avgLeadTimeDays || 0,
  }));

  const leadTimeData = Object.entries(report.leadTime.byRange).map(([range, count]) => ({
    range,
    count,
  }));

  const seasonalData = Object.entries(report.seasonal.byMonth)
    .sort(([a], [b]) => parseInt(a) - parseInt(b))
    .map(([month, count]) => ({
      month: month.split('-')[1] || month,
      count,
    }));

  return (
    <div className="space-y-5">
      <h2 className="text-lg font-bold">אנליטיקס — BI Dashboard</h2>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3 stat-grid-responsive">
        <StatCard label="סה״כ אירועים" value={report.totalItems} color="purple" />
        <StatCard label="ממוצע לחודש" value={report.seasonal.avgPerMonth} color="orange" />
        <StatCard
          label="טווח מכירה עיקרי"
          value={report.leadTime.optimal?.range || '—'}
          color="pink"
        />
        <StatCard
          label="חודשי שיא"
          value={report.seasonal.peakMonths.length}
          color="green"
        />
      </div>

      {/* Charts Grid */}
      <div className="grid grid-cols-2 gap-4">
        {/* Competition Chart */}
        <div className="bg-card border border-border rounded-xl p-5 accent-pink card-elevated">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xs font-medium text-text-dim">אירועים לפי תחרות</h3>
          </div>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={competitionData}>
              <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
              <XAxis dataKey="name" tick={{ fill: tickFill, fontSize: 11 }} />
              <YAxis tick={{ fill: tickFill, fontSize: 11 }} />
              <Tooltip
                contentStyle={{ background: tooltipBg, border: `1px solid ${tooltipBorder}`, borderRadius: 8, color: tooltipColor }}
              />
              <Bar dataKey="count" fill="#E91E8C" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Lead Time Chart */}
        <div className="bg-card border border-border rounded-xl p-5 accent-orange card-elevated">
          <h3 className="text-xs font-medium text-text-dim mb-4">התפלגות Lead Time</h3>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={leadTimeData}>
              <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
              <XAxis dataKey="range" tick={{ fill: tickFill, fontSize: 11 }} />
              <YAxis tick={{ fill: tickFill, fontSize: 11 }} />
              <Tooltip
                contentStyle={{ background: tooltipBg, border: `1px solid ${tooltipBorder}`, borderRadius: 8, color: tooltipColor }}
              />
              <Bar dataKey="count" fill="#FF6B35" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Seasonal Trend — Full Width */}
      <div className="bg-card border border-border rounded-xl p-5 accent-purple card-elevated">
        <h3 className="text-xs font-medium text-text-dim mb-4">מגמה עונתית</h3>
        <ResponsiveContainer width="100%" height={250}>
          <LineChart data={seasonalData}>
            <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
            <XAxis dataKey="month" tick={{ fill: tickFill, fontSize: 11 }} />
            <YAxis tick={{ fill: tickFill, fontSize: 11 }} />
            <Tooltip
              contentStyle={{ background: tooltipBg, border: `1px solid ${tooltipBorder}`, borderRadius: 8, color: tooltipColor }}
            />
            <Line
              type="monotone"
              dataKey="count"
              stroke="#7C3AED"
              strokeWidth={2}
              dot={{ fill: '#E91E8C', r: 4 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Budget Slider */}
      <BudgetSlider />

      {/* Stock Overview */}
      {stockOverview.length > 0 && (
        <div className="bg-card border border-border rounded-xl p-5 accent-green card-elevated">
          <h3 className="text-xs font-medium text-text-dim mb-4">מצב מלאי — WooCommerce</h3>
          <div className="grid grid-cols-2 gap-3">
            {stockOverview.map((item) => (
              <div
                key={item.matchKey}
                className="flex items-center justify-between bg-bg border border-border rounded-lg px-4 py-3"
              >
                <span className="text-sm font-medium truncate max-w-[60%]">
                  {item.matchKey.replace(/__/g, ' | ').replace(/_/g, ' ')}
                </span>
                <StockIndicator matchKey={item.matchKey} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Insights */}
      {report.insights.length > 0 && (
        <div className="bg-card border border-border rounded-xl p-5">
          <h3 className="text-sm font-medium text-text-dim mb-3">תובנות</h3>
          <ul className="space-y-2">
            {report.insights.map((insight, i) => (
              <li key={i} className="flex items-start gap-2 text-sm">
                <span className="text-pink mt-0.5">&#x2022;</span>
                <span>{insight}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <AgentChat agent="cmo" />
    </div>
  );
}
