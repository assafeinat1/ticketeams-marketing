import type { AgentKey } from '../../types/api';

const AGENT_META: Record<AgentKey, { name: string; icon: string; color: string }> = {
  intelligence: { name: 'מודיעין', icon: '🕵️', color: '#7C3AED' },
  finance: { name: 'פיננסים', icon: '💰', color: '#E91E8C' },
  creative: { name: 'קריאייטיב', icon: '🎨', color: '#FF6B35' },
  scout: { name: 'סקאוט', icon: '🔍', color: '#00C875' },
  cmo: { name: 'אנליטיקס', icon: '📊', color: '#579BFC' },
  meta: { name: 'Meta', icon: '📣', color: '#1877F2' },
  orchestrator: { name: 'מתכלל', icon: '🧠', color: '#FFB800' },
};

interface Props {
  agent: AgentKey;
  description?: string;
}

export default function SourceBadge({ agent, description }: Props) {
  const meta = AGENT_META[agent];
  if (!meta) return null;

  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium"
      style={{ backgroundColor: `${meta.color}20`, color: meta.color }}
    >
      {meta.icon} {description || `מסוכן ה${meta.name}`}
    </span>
  );
}
