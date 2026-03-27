import { useState, useEffect } from 'react';
import type { AdVersion } from '../../types/api';
import StatusBadge from '../shared/StatusBadge';
import GradientButton from '../shared/GradientButton';

interface Props {
  version: AdVersion;
  isApproved: boolean;
  isSelected: boolean;
  onSave: (updates: { headline: string; body: string; cta: string }) => Promise<void>;
  onApprove: () => void;
  onRegenerate: () => void;
}

const styleColors: Record<string, string> = {
  'רגשית': 'border-pink/40',
  'מידעית': 'border-purple/40',
  'דחיפות': 'border-orange/40',
};

export default function EditableAdCard({
  version,
  isApproved,
  isSelected,
  onSave,
  onApprove,
  onRegenerate,
}: Props) {
  const [headline, setHeadline] = useState(version.headline);
  const [body, setBody] = useState(version.body);
  const [cta, setCta] = useState(version.cta);
  const [saving, setSaving] = useState(false);

  // Reset when version changes (e.g., after regenerate)
  useEffect(() => {
    setHeadline(version.headline);
    setBody(version.body);
    setCta(version.cta);
  }, [version.headline, version.body, version.cta]);

  const isDirty =
    headline !== version.headline ||
    body !== version.body ||
    cta !== version.cta;

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave({ headline, body, cta });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className={`border rounded-xl p-4 transition-all card-elevated hover:scale-[1.01] ${
        isSelected
          ? 'border-green bg-green/5 ring-1 ring-green/20'
          : styleColors[version.style] || 'border-border'
      }`}
    >
      <div className="flex items-center justify-between mb-3">
        <StatusBadge
          status={
            version.style === 'רגשית'
              ? 'Human'
              : version.style === 'דחיפות'
              ? 'Urgency'
              : 'Stadium'
          }
          size="md"
        />
        <span className="text-[10px] text-text-dim bg-bg-elevated/50 px-2 py-0.5 rounded-full">v{version.index}</span>
      </div>

      {/* Editable fields */}
      <div className="space-y-2 mb-3">
        <input
          value={headline}
          onChange={(e) => setHeadline(e.target.value)}
          disabled={isApproved}
          className="w-full bg-bg/50 border border-border/50 rounded-lg px-3 py-1.5 text-sm font-bold text-text focus:border-pink focus:outline-none disabled:opacity-60 disabled:cursor-not-allowed"
          placeholder="כותרת"
        />
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          disabled={isApproved}
          rows={3}
          className="w-full bg-bg/50 border border-border/50 rounded-lg px-3 py-1.5 text-xs text-text-dim leading-relaxed resize-none focus:border-pink focus:outline-none disabled:opacity-60 disabled:cursor-not-allowed"
          placeholder="גוף המודעה"
        />
        <input
          value={cta}
          onChange={(e) => setCta(e.target.value)}
          disabled={isApproved}
          className="w-full bg-bg/50 border border-border/50 rounded-lg px-3 py-1.5 text-xs font-medium text-pink focus:border-pink focus:outline-none disabled:opacity-60 disabled:cursor-not-allowed"
          placeholder="CTA"
        />
      </div>

      {/* Save changes indicator */}
      {isDirty && !isApproved && (
        <GradientButton
          onClick={handleSave}
          disabled={saving}
          className="w-full text-xs mb-2"
          variant="ghost"
        >
          {saving ? 'שומר...' : 'שמור שינויים'}
        </GradientButton>
      )}

      {/* Action buttons */}
      {!isApproved && (
        <div className="flex gap-2">
          <GradientButton
            onClick={onApprove}
            animateOnClick="approve"
            className="flex-1 text-xs"
          >
            אשר גרסה {version.index}
          </GradientButton>
          <GradientButton
            onClick={onRegenerate}
            variant="ghost"
            className="text-xs"
          >
            צור מחדש
          </GradientButton>
        </div>
      )}

      {isSelected && (
        <div className="flex items-center justify-center gap-1.5 text-green text-xs font-medium mt-3 py-2 bg-green/5 rounded-lg border border-green/15">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          אושר
        </div>
      )}
    </div>
  );
}
