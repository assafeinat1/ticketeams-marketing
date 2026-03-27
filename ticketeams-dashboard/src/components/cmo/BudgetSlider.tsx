import { useState } from 'react';
import Slider from '../ui/Slider';

const CPM = 15; // Cost per 1000 impressions in ILS

function formatNumber(n: number): string {
  return n.toLocaleString('he-IL');
}

export default function BudgetSlider() {
  const [budget, setBudget] = useState(10000);
  const projectedReach = Math.round((budget * 1000) / CPM);

  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <h3 className="text-sm font-medium text-text-dim mb-4">תקציב פרסום ותחזית</h3>

      <div className="mb-6">
        <Slider
          value={budget}
          onValueChange={setBudget}
          min={1000}
          max={50000}
          step={500}
        />
      </div>

      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-text-dim mb-1">תקציב</p>
          <p className="text-2xl font-bold text-pink">₪{formatNumber(budget)}</p>
        </div>
        <div className="text-center">
          <p className="text-xs text-text-dim mb-1">CPM</p>
          <p className="text-lg font-medium text-text-dim">₪{CPM}</p>
        </div>
        <div className="text-left">
          <p className="text-xs text-text-dim mb-1">טווח הגעה משוער</p>
          <p className="text-2xl font-bold text-orange">~{formatNumber(projectedReach)}</p>
        </div>
      </div>

      <div className="mt-4 h-1.5 bg-border rounded-full overflow-hidden">
        <div
          className="h-full rounded-full bg-gradient-to-l from-green to-orange transition-all"
          style={{ width: `${Math.min((budget / 50000) * 100, 100)}%` }}
        />
      </div>
      <div className="flex justify-between text-xs text-text-dim mt-1">
        <span>₪1,000</span>
        <span>₪50,000</span>
      </div>
    </div>
  );
}
