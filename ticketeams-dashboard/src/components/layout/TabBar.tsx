import type { TabKey } from '../../types/api';

const TABS: { key: TabKey; label: string; icon: string; color: string }[] = [
  { key: 'home', label: 'בית', icon: '🏠', color: '#E91E8C' },
  { key: 'scout', label: 'סקאוט', icon: '🔍', color: '#00C875' },
  { key: 'cmo', label: 'אנליטיקס', icon: '📊', color: '#579BFC' },
  { key: 'creative', label: 'קריאייטיב', icon: '🎨', color: '#FF6B35' },
  { key: 'intelligence', label: 'מודיעין', icon: '🕵️', color: '#7C3AED' },
  { key: 'finance', label: 'פיננסים', icon: '💰', color: '#E91E8C' },
  { key: 'meta', label: 'Meta', icon: '🚀', color: '#1877F2' },
  { key: 'orchestrator', label: 'מתכלל', icon: '🧠', color: '#FFB800' },
  { key: 'seo', label: 'SEO', icon: '🌐', color: '#22c55e' },
];

interface Props {
  activeTab: TabKey;
  onTabChange: (tab: TabKey) => void;
}

export default function TabBar({ activeTab, onTabChange }: Props) {
  return (
    <nav className="px-6 border-b border-border bg-bg-elevated/60 tab-bar-scroll mobile-px">
      <div className="flex gap-1">
        {TABS.map((tab) => {
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => onTabChange(tab.key)}
              className={`px-4 py-3 text-sm font-medium transition-all cursor-pointer relative flex items-center gap-2 rounded-t-lg whitespace-nowrap ${
                isActive
                  ? 'text-text bg-card/50'
                  : 'text-text-dim hover:text-text hover:bg-card/30'
              }`}
            >
              <span className="text-sm">{tab.icon}</span>
              <span className="text-[13px]">{tab.label}</span>
              {isActive && (
                <div
                  className="absolute bottom-0 right-0 left-0 h-[3px] rounded-full"
                  style={{ backgroundColor: tab.color }}
                />
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
