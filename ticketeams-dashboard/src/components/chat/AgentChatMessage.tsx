import type { ChatMessage, AgentKey } from '../../types/api';
import SourceBadge from './SourceBadge';

const AGENT_META: Record<AgentKey, { name: string; icon: string; color: string }> = {
  intelligence: { name: 'מודיעין', icon: '🕵️', color: '#7C3AED' },
  finance: { name: 'פיננסים', icon: '💰', color: '#E91E8C' },
  creative: { name: 'קריאייטיב', icon: '🎨', color: '#FF6B35' },
  scout: { name: 'סקאוט', icon: '🔍', color: '#00C875' },
  cmo: { name: 'אנליטיקס', icon: '📊', color: '#579BFC' },
  meta: { name: 'Meta', icon: '📣', color: '#1877F2' },
  orchestrator: { name: 'מתכלל', icon: '🧠', color: '#FFB800' },
  seo: { name: 'SEO', icon: '🌐', color: '#22c55e' },
};

interface Props {
  message: ChatMessage;
}

function renderContent(text: string) {
  // Simple markdown-like: **bold** and line breaks
  const parts = text.split(/(\*\*.*?\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    // Handle line breaks
    return part.split('\n').map((line, j) => (
      <span key={`${i}-${j}`}>
        {j > 0 && <br />}
        {line}
      </span>
    ));
  });
}

export default function AgentChatMessage({ message }: Props) {
  const isUser = message.role === 'user';
  const agent = message.agent;
  const meta = agent ? AGENT_META[agent] : null;

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] bg-gradient-to-l from-pink/10 to-purple/10 border border-pink/15 rounded-2xl rounded-bl-sm px-4 py-3">
          <p className="text-sm whitespace-pre-wrap">{message.content}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start">
      <div
        className="max-w-[80%] bg-card border border-border rounded-2xl rounded-br-sm px-4 py-3 border-r-[3px]"
        style={{ borderRightColor: meta?.color || '#888' }}
      >
        {meta && (
          <div className="flex items-center gap-1.5 mb-2">
            <span className="text-sm">{meta.icon}</span>
            <span className="text-xs font-semibold" style={{ color: meta.color }}>
              {meta.name}
            </span>
          </div>
        )}
        <div className="text-sm whitespace-pre-wrap leading-relaxed">
          {renderContent(message.content)}
        </div>
        {message.sources && message.sources.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2 pt-2 border-t border-border">
            {message.sources.map((s, i) => (
              <SourceBadge key={i} agent={s.agent} description={s.description} />
            ))}
          </div>
        )}
        {message.actions?.map((action, i) => (
          action.type === 'generated_creative' && action.data && typeof action.data === 'object' && 'imageUrl' in (action.data as Record<string, unknown>) && (
            <div key={i} className="mt-3 min-w-[300px]">
              <img
                src={(action.data as Record<string, string>).imageUrl}
                alt="creative preview"
                className="rounded-xl max-w-full w-full border border-border shadow-sm"
              />
            </div>
          )
        ))}
      </div>
    </div>
  );
}
