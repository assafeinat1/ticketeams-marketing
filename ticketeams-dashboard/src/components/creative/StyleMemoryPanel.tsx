import { useState, useCallback } from 'react';
import { apiClient } from '../../api/client';
import { usePolling } from '../../hooks/usePolling';
import { useToast } from '../../hooks/useToast';

interface StyleEntry {
  type: 'positive' | 'negative';
  note: string;
  timestamp: string;
}

export default function StyleMemoryPanel() {
  const [memory, setMemory] = useState<StyleEntry[]>([]);
  const [input, setInput] = useState('');
  const [type, setType] = useState<'positive' | 'negative'>('positive');
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const { showToast } = useToast();

  const loadMemory = useCallback(async () => {
    try {
      const { data } = await apiClient.get('/api/creative/style-memory');
      setMemory(data);
    } catch {
      // Backend may not be running
    }
  }, []);

  usePolling(loadMemory, 60000);

  const handleAdd = async () => {
    if (!input.trim()) return;
    setSaving(true);
    try {
      await apiClient.post('/api/creative/style-feedback', { type, note: input.trim() });
      setInput('');
      showToast('success', 'העדפה נשמרה');
      await loadMemory();
    } catch {
      showToast('error', 'שגיאה בשמירה');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-card border border-border rounded-xl p-4 card-elevated">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between text-sm font-medium text-text-dim hover:text-text transition-colors cursor-pointer bg-transparent border-0 p-0"
      >
        <span className="flex items-center gap-2">
          <span className="w-5 h-5 rounded-md bg-gradient-to-br from-pink/20 to-purple/20 flex items-center justify-center text-[10px]">🎨</span>
          זיכרון סגנון ({memory.length})
        </span>
        <svg
          width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          className={`transition-transform ${expanded ? 'rotate-180' : ''}`}
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {expanded && (
        <div className="mt-3 space-y-3 animate-[fadeIn_150ms]">
          {/* Existing preferences */}
          {memory.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {memory.map((entry, i) => (
                <span
                  key={i}
                  className={`text-[10px] px-2 py-0.5 rounded-full ${
                    entry.type === 'positive'
                      ? 'bg-green/15 text-green'
                      : 'bg-red/15 text-red'
                  }`}
                >
                  {entry.type === 'positive' ? '👍' : '👎'} {entry.note}
                </span>
              ))}
            </div>
          )}

          {/* Add new preference */}
          <div className="flex gap-2">
            <select
              value={type}
              onChange={(e) => setType(e.target.value as 'positive' | 'negative')}
              className="bg-bg border border-border rounded-lg px-2 py-1.5 text-xs text-text"
            >
              <option value="positive">אוהב</option>
              <option value="negative">לא אוהב</option>
            </select>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); }}
              placeholder="הוסף העדפה..."
              className="flex-1 bg-bg border border-border rounded-lg px-3 py-1.5 text-xs text-text focus:border-pink focus:outline-none"
            />
            <button
              onClick={handleAdd}
              disabled={saving || !input.trim()}
              className="px-3 py-1.5 rounded-lg bg-pink/20 text-pink text-xs font-medium hover:bg-pink/30 transition-colors cursor-pointer border-0 disabled:opacity-40"
            >
              {saving ? '...' : 'שמור'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
