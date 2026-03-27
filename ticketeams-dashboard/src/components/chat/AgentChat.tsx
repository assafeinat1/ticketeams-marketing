import { useState, useRef, useEffect, useCallback } from 'react';
import { sendChatMessage, getAgentMemory, deleteAgentMemoryEntry } from '../../api/agentChat';
import type { AgentMemory } from '../../api/agentChat';
import type { AgentKey, ChatMessage } from '../../types/api';
import AgentChatMessage from './AgentChatMessage';
import AgentChatInput from './AgentChatInput';

const AGENT_CONFIG: Record<AgentKey, { name: string; icon: string; color: string; placeholder: string; loadingText: string }> = {
  intelligence: { name: 'מודיעין', icon: '🕵️', color: '#7C3AED', placeholder: 'שאל את סוכן המודיעין...', loadingText: 'מנתח נתוני מתחרים...' },
  finance: { name: 'פיננסים', icon: '💰', color: '#E91E8C', placeholder: 'שאל את סוכן הפיננסים...', loadingText: 'מחשב רווחיות...' },
  creative: { name: 'קריאייטיב', icon: '🎨', color: '#FF6B35', placeholder: 'שאל את סוכן הקריאייטיב...', loadingText: 'מכין עיצוב...' },
  scout: { name: 'סקאוט', icon: '🔍', color: '#00C875', placeholder: 'שאל את הסקאוט...', loadingText: 'סורק אירועים...' },
  cmo: { name: 'אנליטיקס', icon: '📊', color: '#579BFC', placeholder: 'שאל את סוכן האנליטיקס...', loadingText: 'מנתח נתונים...' },
  meta: { name: 'Meta', icon: '📣', color: '#1877F2', placeholder: 'שאל את סוכן המטא...', loadingText: 'בודק קמפיינים...' },
  orchestrator: { name: 'מתכלל', icon: '🧠', color: '#FFB800', placeholder: 'שאל את המתכלל...', loadingText: 'מתאם סוכנים...' },
  seo: { name: 'SEO', icon: '🌐', color: '#22c55e', placeholder: 'שאל את סוכן ה-SEO...', loadingText: 'מנתח תוכן ו-SEO...' },
};

interface Props {
  agent: AgentKey;
  context?: Record<string, unknown>;
}

type ChatMode = 'collapsed' | 'expanded' | 'fullscreen';

export default function AgentChat({ agent, context }: Props) {
  const config = AGENT_CONFIG[agent];
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<ChatMode>('collapsed');
  const [memory, setMemory] = useState<AgentMemory | null>(null);
  const [showMemory, setShowMemory] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  const refreshMemory = useCallback(async () => {
    try {
      const mem = await getAgentMemory(agent);
      setMemory(mem);
    } catch { /* ignore */ }
  }, [agent]);

  useEffect(() => {
    refreshMemory();
  }, [refreshMemory]);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  const handleSend = async (text: string) => {
    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: text,
      timestamp: new Date().toISOString(),
    };

    setMessages(prev => [...prev, userMessage]);
    setLoading(true);

    // Auto-expand when sending first message
    if (mode === 'collapsed') setMode('expanded');

    try {
      const history = messages.map(m => ({ role: m.role, content: m.content }));
      // Trim to last 20 messages for API
      const trimmedHistory = history.slice(-20);

      const response = await sendChatMessage({
        agent,
        message: text,
        conversationHistory: trimmedHistory,
        context,
      });

      const assistantMessage: ChatMessage = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: response.reply,
        agent,
        sources: response.sources,
        actions: response.actions,
        timestamp: new Date().toISOString(),
      };

      setMessages(prev => [...prev, assistantMessage]);
      // Refresh memory — message may have triggered pattern detection
      refreshMemory();
    } catch {
      const errorMessage: ChatMessage = {
        id: `error-${Date.now()}`,
        role: 'assistant',
        content: 'מצטער, אירעה שגיאה. נסה שוב.',
        agent,
        timestamp: new Date().toISOString(),
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setLoading(false);
    }
  };

  const toggleMode = () => {
    setMode(prev => {
      if (prev === 'collapsed') return 'expanded';
      if (prev === 'expanded') return 'collapsed';
      return 'expanded';
    });
  };

  const toggleFullscreen = () => {
    setMode(prev => prev === 'fullscreen' ? 'expanded' : 'fullscreen');
  };

  const handleDeleteMemory = async (index: number) => {
    try {
      await deleteAgentMemoryEntry(agent, index);
      refreshMemory();
    } catch { /* ignore */ }
  };

  const memoryCount = memory ? memory.corrections.length + memory.preferences.length : 0;

  // Fullscreen overlay
  if (mode === 'fullscreen') {
    return (
      <div className="fixed inset-0 z-50 bg-bg flex flex-col animate-[fadeIn_200ms]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <span className="text-lg">{config.icon}</span>
            <span className="font-medium" style={{ color: config.color }}>{config.name}</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={toggleFullscreen}
              className="w-8 h-8 rounded-lg bg-card border border-border flex items-center justify-center text-text-dim hover:text-text transition-colors cursor-pointer"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 3v3a2 2 0 01-2 2H3m18 0h-3a2 2 0 01-2-2V3m0 18v-3a2 2 0 012-2h3M3 16h3a2 2 0 012 2v3" /></svg>
            </button>
            <button
              onClick={() => setMode('expanded')}
              className="w-8 h-8 rounded-lg bg-card border border-border flex items-center justify-center text-text-dim hover:text-text transition-colors cursor-pointer"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4" ref={containerRef}>
          {messages.length === 0 && (
            <div className="text-center text-text-dim py-12">
              <p className="text-3xl mb-2">{config.icon}</p>
              <p className="text-sm">{config.placeholder}</p>
            </div>
          )}
          {messages.map(msg => (
            <AgentChatMessage key={msg.id} message={msg} />
          ))}
          {loading && (
            <div className="flex justify-start">
              <div className="bg-card border border-border rounded-2xl px-4 py-3 border-r-[3px]" style={{ borderRightColor: config.color }}>
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1">
                    <span className="typing-dot" style={{ backgroundColor: config.color }} />
                    <span className="typing-dot" style={{ backgroundColor: config.color }} />
                    <span className="typing-dot" style={{ backgroundColor: config.color }} />
                  </div>
                  <span className="text-xs text-text-dim">{config.loadingText}</span>
                </div>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="px-5 py-3 border-t border-border">
          <AgentChatInput
            placeholder={config.placeholder}
            onSend={handleSend}
            disabled={loading}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      {/* Header bar */}
      <div
        onClick={toggleMode}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') toggleMode(); }}
        className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-card-hover transition-colors cursor-pointer"
      >
        <div className="flex items-center gap-2">
          <span className="text-sm">{config.icon}</span>
          <span className="text-xs font-medium" style={{ color: config.color }}>
            צ'אט עם {config.name}
          </span>
          {messages.length > 0 && (
            <span className="text-[10px] text-text-dim bg-bg rounded-full px-1.5 py-0.5">
              {messages.length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {memoryCount > 0 && (
            <button
              onClick={(e) => { e.stopPropagation(); setShowMemory(!showMemory); }}
              className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-bg border border-border text-text-dim hover:text-text transition-colors cursor-pointer"
              title="זיכרון סוכן"
            >
              <span>{`זיכרון (${memoryCount})`}</span>
            </button>
          )}
          {mode === 'expanded' && (
            <button
              onClick={(e) => { e.stopPropagation(); toggleFullscreen(); }}
              className="w-6 h-6 rounded flex items-center justify-center text-text-dim hover:text-text transition-colors cursor-pointer"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" /></svg>
            </button>
          )}
          <svg
            width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            className={`text-text-dim transition-transform ${mode === 'expanded' ? 'rotate-180' : ''}`}
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        </div>
      </div>

      {/* Memory panel */}
      {showMemory && memory && (
        <div className="border-t border-border bg-bg px-4 py-3 space-y-2 animate-[fadeIn_150ms]">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-medium text-text-dim">העדפות שנשמרו</span>
            <button
              onClick={() => setShowMemory(false)}
              className="text-[10px] text-text-dim hover:text-text cursor-pointer"
            >
              סגור
            </button>
          </div>
          {[...memory.preferences, ...memory.corrections].map((entry, i) => (
            <div key={i} className="flex items-start justify-between gap-2 text-[10px] bg-card rounded-lg px-2 py-1.5">
              <div className="flex-1 min-w-0">
                <span className={`inline-block px-1 rounded text-[9px] font-medium mr-1 ${
                  entry.category === 'positive' ? 'bg-green/20 text-green' :
                  entry.category === 'negative' ? 'bg-red/20 text-red' :
                  entry.category === 'rule' ? 'bg-purple/20 text-purple' :
                  'bg-pink/20 text-pink'
                }`}>
                  {entry.category === 'text_length' ? 'אורך' :
                   entry.category === 'correction' ? 'תיקון' :
                   entry.category === 'positive' ? 'חיובי' :
                   entry.category === 'negative' ? 'שלילי' :
                   entry.category === 'rule' ? 'כלל' : entry.category}
                </span>
                <span className="text-text truncate">{entry.detail}</span>
              </div>
              <button
                onClick={() => handleDeleteMemory(i)}
                className="text-text-dim hover:text-red transition-colors shrink-0 cursor-pointer"
                title="מחק"
              >
                ✕
              </button>
            </div>
          ))}
          {memoryCount === 0 && (
            <p className="text-[10px] text-text-dim text-center py-2">אין העדפות שמורות</p>
          )}
        </div>
      )}

      {/* Expanded content */}
      {mode === 'expanded' && (
        <div className="animate-[fadeIn_150ms]">
          {/* Messages area */}
          <div className="max-h-[400px] overflow-y-auto px-4 py-3 space-y-3 border-t border-border" ref={containerRef}>
            {messages.length === 0 && (
              <div className="text-center text-text-dim py-6">
                <p className="text-2xl mb-1">{config.icon}</p>
                <p className="text-xs">{config.placeholder}</p>
              </div>
            )}
            {messages.map(msg => (
              <AgentChatMessage key={msg.id} message={msg} />
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="bg-bg border border-border rounded-2xl px-4 py-3 border-r-[3px]" style={{ borderRightColor: config.color }}>
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1">
                      <span className="typing-dot" style={{ backgroundColor: config.color }} />
                      <span className="typing-dot" style={{ backgroundColor: config.color }} />
                      <span className="typing-dot" style={{ backgroundColor: config.color }} />
                    </div>
                    <span className="text-xs text-text-dim">{config.loadingText}</span>
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="px-4 py-2.5 border-t border-border">
            <AgentChatInput
              placeholder={config.placeholder}
              onSend={handleSend}
              disabled={loading}
            />
          </div>
        </div>
      )}

      {/* Collapsed — show just input inline */}
      {mode === 'collapsed' && (
        <div className="px-4 py-2.5 border-t border-border">
          <AgentChatInput
            placeholder={config.placeholder}
            onSend={handleSend}
            disabled={loading}
          />
        </div>
      )}
    </div>
  );
}
