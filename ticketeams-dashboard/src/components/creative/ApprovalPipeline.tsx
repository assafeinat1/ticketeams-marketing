import { useState } from 'react';
import type { PendingApproval } from '../../types/api';
import GradientButton from '../shared/GradientButton';

type PipelineStep = 'creative' | 'finance' | 'meta';

interface Props {
  approval: PendingApproval;
  onPublish: (matchKey: string) => void;
  publishing?: boolean;
}

const STEPS: { key: PipelineStep; label: string; icon: string; description: string }[] = [
  { key: 'creative', label: 'קריאייטיב', icon: '🎨', description: 'גרסה אושרה' },
  { key: 'finance', label: 'פיננסים', icon: '💰', description: 'תקציב מוכן' },
  { key: 'meta', label: 'Meta', icon: '📣', description: 'מוכן לפרסום' },
];

const targetingLabels: Record<string, string> = {
  broad_prospecting: 'קהל רחב (Prospecting)',
  purchase_lookalike: 'דומים לרוכשים (Lookalike)',
  remarketing: 'רימרקטינג',
};

function getActiveStep(approval: PendingApproval): PipelineStep {
  if (approval.status !== 'אושר') return 'creative';
  if (!approval.budgetRecommendation && !approval.pricingReport?.recommendations?.length) return 'finance';
  return 'meta';
}

function getStepState(step: PipelineStep, activeStep: PipelineStep): 'completed' | 'active' | 'pending' {
  const order: PipelineStep[] = ['creative', 'finance', 'meta'];
  const stepIdx = order.indexOf(step);
  const activeIdx = order.indexOf(activeStep);
  if (stepIdx < activeIdx) return 'completed';
  if (stepIdx === activeIdx) return 'active';
  return 'pending';
}

export default function ApprovalPipeline({ approval, onPublish, publishing }: Props) {
  const activeStep = getActiveStep(approval);
  const [expanded, setExpanded] = useState(true);

  const budget = approval.budgetRecommendation;

  return (
    <div className="border border-border rounded-xl overflow-hidden bg-card">
      {/* Header */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 bg-bg-elevated/30 cursor-pointer border-0 text-right"
      >
        <span className="text-xs font-medium text-text-dim flex items-center gap-2">
          Pipeline
          <span className="text-[10px] bg-pink/10 text-pink px-2 py-0.5 rounded-full">
            {activeStep === 'meta' ? 'מוכן' : activeStep === 'finance' ? 'ממתין לתקציב' : 'אושר'}
          </span>
        </span>
        <svg
          width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          className={`transition-transform text-text-dim ${expanded ? 'rotate-180' : ''}`}
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {expanded && (
        <div className="p-4 space-y-3 animate-[fadeIn_200ms]">
          {/* Inline Steps */}
          <div className="space-y-2">
            {STEPS.map((step, i) => {
              const state = getStepState(step.key, activeStep);
              return (
                <div
                  key={step.key}
                  className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-all ${
                    state === 'completed' ? 'bg-green/5' :
                    state === 'active' ? 'bg-pink/5 border border-pink/20' :
                    'bg-bg'
                  }`}
                >
                  {/* Status icon */}
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs shrink-0 ${
                    state === 'completed' ? 'bg-green/20' :
                    state === 'active' ? 'bg-pink/20' :
                    'bg-border'
                  }`}>
                    {state === 'completed' ? (
                      <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                        <path d="M3 8l4 4 6-7" stroke="#22c55e" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    ) : state === 'active' ? (
                      <div className="w-2.5 h-2.5 rounded-full bg-pink animate-pulse" />
                    ) : (
                      <div className="w-2 h-2 rounded-full bg-text-dim/30" />
                    )}
                  </div>

                  {/* Step info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-text">
                        Step {i + 1}: {step.description}
                      </span>
                    </div>
                    {step.key === 'finance' && state !== 'pending' && budget && (
                      <span className="text-[10px] text-text-dim">
                        ₪{budget.recommendedDailyBudget}/יום · {budget.recommendedDuration} ימים · {targetingLabels[budget.recommendedTargeting] || budget.recommendedTargeting}
                      </span>
                    )}
                    {step.key === 'creative' && state === 'completed' && approval.selectedVersion != null && (
                      <span className="text-[10px] text-text-dim">
                        {approval.versions.length} פורמטים (Story + Square)
                      </span>
                    )}
                    {step.key === 'meta' && state === 'active' && budget && (
                      <span className="text-[10px] text-text-dim">
                        סוכן פיננסים — ₪{budget.recommendedDailyBudget}/יום
                      </span>
                    )}
                  </div>

                  {/* Step icon */}
                  <span className="text-sm shrink-0">{step.icon}</span>
                </div>
              );
            })}
          </div>

          {/* Budget detail card */}
          {activeStep === 'meta' && budget && (
            <div className="p-3 bg-bg rounded-lg text-xs space-y-1 border border-border/30">
              <p className="text-text-dim font-medium mb-2">המלצת תקציב:</p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                <p className="text-text">
                  <span className="text-text-dim">יומי: </span>
                  ₪{budget.recommendedDailyBudget}
                </p>
                <p className="text-text">
                  <span className="text-text-dim">משך: </span>
                  {budget.recommendedDuration} ימים
                </p>
                <p className="text-text">
                  <span className="text-text-dim">טירגוט: </span>
                  {targetingLabels[budget.recommendedTargeting] ?? budget.recommendedTargeting}
                </p>
                <p className="text-text">
                  <span className="text-text-dim">סה״כ: </span>
                  ₪{budget.totalEstimatedBudget.toLocaleString()}
                </p>
              </div>
            </div>
          )}

          {activeStep === 'meta' && !budget && (
            <div className="p-2 bg-bg rounded-lg text-xs border border-border/30">
              <p className="text-text-dim">המלצת תקציב: לא זמין</p>
            </div>
          )}

          {/* Publish button */}
          {activeStep === 'meta' && (
            <GradientButton
              onClick={() => onPublish(approval.matchKey)}
              disabled={publishing}
              className="w-full text-xs"
              animateOnClick="approve"
            >
              {publishing ? 'מפרסם...' : 'פרסם קמפיין (PAUSED)'}
            </GradientButton>
          )}
        </div>
      )}
    </div>
  );
}
