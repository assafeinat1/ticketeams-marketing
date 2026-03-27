import { useState, useCallback, useMemo } from 'react';
import { apiClient } from '../../api/client';
import { usePolling } from '../../hooks/usePolling';
import StatusBadge from '../shared/StatusBadge';

interface GalleryItem {
  matchKey: string;
  createdAt: string | null;
  status: string;
  versions: Array<{ style: string; headline: string; imageUrl: string | null }>;
}

function statusGlowClass(status: string): string {
  if (status === 'אושר') return 'gallery-glow-green';
  if (status === 'פורסם') return 'gallery-glow-green';
  return 'gallery-glow-orange';
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleDateString('he-IL', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function CreativeGallery() {
  const [items, setItems] = useState<GalleryItem[]>([]);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [filterEvent, setFilterEvent] = useState<string>('all');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const loadGallery = useCallback(async () => {
    try {
      const { data } = await apiClient.get('/api/creative/gallery');
      setItems(data);
    } catch {
      // Backend may not be running
    }
  }, []);

  usePolling(loadGallery, 30000);

  // Unique event names for filter
  const eventNames = useMemo(() => {
    const names = [...new Set(items.map(i => i.matchKey))];
    return names.map(k => ({
      key: k,
      label: k.replace(/__/g, ' vs ').replace(/_/g, ' '),
    }));
  }, [items]);

  const filteredItems = useMemo(() => {
    if (filterEvent === 'all') return items;
    return items.filter(i => i.matchKey === filterEvent);
  }, [items, filterEvent]);

  const allImages = filteredItems.flatMap(item =>
    item.versions
      .filter(v => v.imageUrl)
      .map(v => ({
        url: v.imageUrl!,
        headline: v.headline,
        style: v.style,
        matchKey: item.matchKey,
        status: item.status,
        createdAt: item.createdAt,
        eventName: item.matchKey.replace(/__/g, ' vs ').replace(/_/g, ' '),
      }))
  );

  const handleClick = (matchKey: string, url: string) => {
    setSelectedKey(matchKey);
    setLightboxUrl(url);
  };

  return (
    <div className="bg-card border border-border rounded-xl p-4 card-elevated">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-text-dim">גלריית קריאייטיב</h3>
        {eventNames.length > 1 && (
          <select
            value={filterEvent}
            onChange={(e) => setFilterEvent(e.target.value)}
            className="bg-bg border border-border rounded-lg px-2 py-1 text-[10px] text-text-dim max-w-[140px] truncate focus:border-pink focus:outline-none"
          >
            <option value="all">כל האירועים</option>
            {eventNames.map(e => (
              <option key={e.key} value={e.key}>{e.label}</option>
            ))}
          </select>
        )}
      </div>

      {allImages.length === 0 ? (
        <div className="bg-bg rounded-xl p-6 text-center">
          <div className="w-14 h-14 mx-auto mb-3 rounded-2xl bg-gradient-to-br from-pink/10 to-purple/10 flex items-center justify-center">
            <span className="text-2xl">🖼️</span>
          </div>
          <p className="text-xs text-text-dim">אין תמונות בגלריה</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2.5 gallery-mobile-scroll">
          {allImages.map((img, i) => (
            <button
              key={i}
              type="button"
              className={`relative group rounded-xl overflow-hidden aspect-square cursor-pointer border-2 p-0 bg-transparent transition-all duration-300 hover:shadow-lg ${statusGlowClass(img.status)} ${
                selectedKey === img.matchKey ? 'ring-2 ring-pink ring-offset-2 ring-offset-card' : ''
              }`}
              onClick={() => handleClick(img.matchKey, img.url)}
            >
              <img
                src={img.url}
                alt={img.headline}
                className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                loading="lazy"
              />
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors" />
              <div className="absolute top-1.5 right-1.5">
                <StatusBadge
                  status={img.status === 'אושר' ? 'approved' : img.status === 'פורסם' ? 'published' : 'pending'}
                  size="sm"
                />
              </div>
              {/* Date shown on hover */}
              {img.createdAt && (
                <div className="absolute top-1.5 left-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  <span className="text-[9px] bg-black/60 text-white/80 px-1.5 py-0.5 rounded-md">
                    {formatDate(img.createdAt)}
                  </span>
                </div>
              )}
              <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent p-2.5 pt-6">
                <p className="text-[10px] text-white/70 truncate mb-0.5">{img.eventName}</p>
                <p className="text-[11px] text-white truncate font-medium">{img.headline}</p>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Lightbox */}
      {lightboxUrl && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center animate-[fadeIn_200ms] cursor-pointer"
          onClick={() => setLightboxUrl(null)}
          role="dialog"
          aria-modal="true"
        >
          <button
            type="button"
            className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white text-xl transition-colors cursor-pointer border-0"
            onClick={() => setLightboxUrl(null)}
          >
            ✕
          </button>
          <img
            src={lightboxUrl}
            alt=""
            className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}
