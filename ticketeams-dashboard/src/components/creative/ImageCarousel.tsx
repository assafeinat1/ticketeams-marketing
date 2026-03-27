import { useState } from 'react';
import type { AdVersion } from '../../types/api';

interface Props {
  versions: AdVersion[];
}

const styleGradients: Record<string, string> = {
  'רגשית': 'from-pink/30 to-purple/30',
  'מידעית': 'from-purple/30 to-pink/30',
  'דחיפות': 'from-orange/30 to-red/30',
};

const styleLabels: Record<string, string> = {
  'רגשית': 'Human',
  'מידעית': 'Stadium',
  'דחיפות': 'Urgency',
};

const styleEmojis: Record<string, string> = {
  'רגשית': '❤️',
  'מידעית': '🏟️',
  'דחיפות': '⚡',
};

const styleBorderColors: Record<string, string> = {
  'רגשית': 'border-pink/40',
  'מידעית': 'border-purple/40',
  'דחיפות': 'border-orange/40',
};

export default function ImageCarousel({ versions }: Props) {
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [lightboxAlt, setLightboxAlt] = useState('');

  return (
    <>
      <div className="flex gap-4 overflow-x-auto pb-3 snap-x snap-mandatory scrollbar-thin">
        {versions.map((v) => (
          <div
            key={v.index}
            className={`snap-center shrink-0 w-[420px] rounded-xl overflow-hidden border ${styleBorderColors[v.style] || 'border-border'} bg-card card-elevated`}
          >
            {/* Image — larger preview */}
            <div className="relative group h-56">
              {v.imageUrl ? (
                <button
                  type="button"
                  className="w-full h-full cursor-pointer border-0 p-0 bg-transparent"
                  onClick={() => {
                    setLightboxUrl(v.imageUrl!);
                    setLightboxAlt(v.headline);
                  }}
                >
                  <img
                    src={v.imageUrl}
                    alt={v.headline}
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                    <svg
                      width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"
                      className="opacity-0 group-hover:opacity-80 transition-opacity drop-shadow-lg"
                    >
                      <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
                    </svg>
                  </div>
                </button>
              ) : (
                <div className={`w-full h-full bg-gradient-to-br ${styleGradients[v.style] || 'from-card to-border'} flex flex-col items-center justify-center gap-2`}>
                  <span className="text-5xl opacity-50">{styleEmojis[v.style] || '🎨'}</span>
                  <span className="text-xs text-text-dim">{styleLabels[v.style] || v.style} — v{v.index}</span>
                  <span className="text-[10px] text-text-dim/60">Canva image placeholder</span>
                </div>
              )}
              {/* Style badge */}
              <div className="absolute top-2 right-2 pointer-events-none">
                <span className="text-[10px] bg-black/60 text-white px-2 py-0.5 rounded-full font-medium">
                  {styleLabels[v.style] || v.style} · v{v.index}
                </span>
              </div>
            </div>

            {/* Text info under image */}
            <div className="p-3 space-y-1.5">
              <p className="text-sm font-bold text-text truncate">{v.headline}</p>
              <p className="text-xs text-text-dim line-clamp-2 leading-relaxed">{v.body}</p>
              <div className="flex items-center justify-between pt-1">
                <span className="text-[11px] font-medium text-pink">{v.cta}</span>
                <span className="text-[10px] text-text-dim/60">{v.style}</span>
              </div>
            </div>
          </div>
        ))}
      </div>

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
            alt={lightboxAlt}
            className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </>
  );
}
