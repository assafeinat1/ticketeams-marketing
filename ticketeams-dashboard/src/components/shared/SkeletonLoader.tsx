interface Props {
  rows?: number;
  cols?: number;
  type?: 'cards' | 'table' | 'text' | 'chart';
}

export default function SkeletonLoader({ rows = 3, cols = 4, type = 'cards' }: Props) {
  if (type === 'cards') {
    return (
      <div className="grid grid-cols-4 gap-3 stat-grid-responsive">
        {Array.from({ length: cols }).map((_, i) => (
          <div key={i} className="bg-card border border-border rounded-xl p-5 space-y-3">
            <div className="skeleton h-3 w-20" />
            <div className="skeleton h-7 w-16" />
          </div>
        ))}
      </div>
    );
  }

  if (type === 'chart') {
    return (
      <div className="bg-card border border-border rounded-xl p-5 card-elevated">
        <div className="skeleton h-3 w-32 mb-4" />
        <div className="flex items-end gap-2 h-[180px]">
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="skeleton flex-1 rounded-t"
              style={{ height: `${30 + Math.random() * 70}%` }}
            />
          ))}
        </div>
      </div>
    );
  }

  if (type === 'table') {
    return (
      <div className="bg-card border border-border rounded-xl overflow-hidden card-elevated">
        <div className="bg-bg-elevated/50 px-4 py-3.5 flex gap-8">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="skeleton h-3 w-16" />
          ))}
        </div>
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="px-4 py-3 border-t border-border/50 flex gap-8">
            {Array.from({ length: 5 }).map((_, j) => (
              <div key={j} className="skeleton h-3" style={{ width: `${60 + Math.random() * 40}px` }} />
            ))}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="skeleton h-4" style={{ width: `${60 + Math.random() * 30}%` }} />
      ))}
    </div>
  );
}
