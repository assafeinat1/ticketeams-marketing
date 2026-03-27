import { useState, useEffect, useRef } from 'react';

interface Props {
  label: string;
  value: string | number;
  color?: string;
  trend?: { direction: 'up' | 'down'; value: string };
  pulse?: boolean;
}

const ACCENT_MAP: Record<string, string> = {
  pink: 'accent-pink',
  orange: 'accent-orange',
  purple: 'accent-purple',
  green: 'accent-green',
  red: 'accent-red',
  blue: 'accent-blue',
  gold: 'accent-gold',
};

const TEXT_MAP: Record<string, string> = {
  pink: 'text-pink',
  orange: 'text-orange',
  purple: 'text-purple',
  green: 'text-green',
  red: 'text-red',
  blue: 'text-blue',
  gold: 'text-gold',
};

function useCountUp(target: number, duration = 600): number {
  const [current, setCurrent] = useState(0);
  const prevTarget = useRef(0);

  useEffect(() => {
    if (target === prevTarget.current) return;
    const start = prevTarget.current;
    prevTarget.current = target;
    const startTime = performance.now();

    function tick(now: number) {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      // Ease out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      setCurrent(Math.round(start + (target - start) * eased));
      if (progress < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }, [target, duration]);

  return current;
}

export default function StatCard({ label, value, color = 'pink', trend, pulse }: Props) {
  const isNumeric = typeof value === 'number';
  const animatedValue = useCountUp(isNumeric ? value : 0);
  const displayValue = isNumeric ? animatedValue : value;

  return (
    <div className={`bg-card border border-border rounded-xl p-5 card-elevated min-h-[88px] transition-all duration-200 hover:scale-[1.02] hover:bg-card-hover ${ACCENT_MAP[color] || ''} ${pulse ? 'pulse-active' : ''}`}>
      <p className="text-text-dim text-xs mb-1.5">{label}</p>
      <p className={`text-2xl font-bold ${TEXT_MAP[color] || 'text-text'}`}>
        {displayValue}
      </p>
      {trend && (
        <p className={`text-xs mt-1.5 ${trend.direction === 'up' ? 'text-green' : 'text-red'}`}>
          {trend.direction === 'up' ? '▲' : '▼'} {trend.value}
        </p>
      )}
    </div>
  );
}
