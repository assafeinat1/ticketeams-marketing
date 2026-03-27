import type { AdVersion } from '../../types/api';

interface Props {
  version: AdVersion;
  matchName: string;
}

export default function AdPreviewCard({ version, matchName }: Props) {
  const fb = version.meta?.facebook;
  const ig = version.meta?.instagram;

  return (
    <div className="grid grid-cols-2 gap-4">
      {/* Facebook Preview */}
      <div className="bg-[#1a1a2e] border border-[#2a2a4a] rounded-xl overflow-hidden">
        <div className="px-4 py-2 border-b border-[#2a2a4a] flex items-center gap-2">
          <div className="w-6 h-6 rounded-full bg-[#1877F2] flex items-center justify-center text-white text-xs font-bold">f</div>
          <span className="text-xs font-medium">Facebook Ad Preview</span>
        </div>

        {/* Image area */}
        <div className="h-36 bg-gradient-to-br from-pink/20 to-purple/20 flex items-center justify-center">
          {version.imageUrl ? (
            <img src={version.imageUrl} alt={matchName} className="w-full h-full object-cover" />
          ) : (
            <span className="text-3xl opacity-40">🏟️</span>
          )}
        </div>

        {/* Ad content */}
        <div className="p-4 space-y-2">
          <p className="text-xs text-text-dim leading-relaxed line-clamp-3">
            {fb?.primary_text || version.body}
          </p>
          <div className="border-t border-[#2a2a4a] pt-2">
            <p className="text-sm font-bold">{fb?.headline || version.headline}</p>
            <p className="text-xs text-text-dim">{fb?.description || version.cta}</p>
          </div>
          <div className="flex items-center gap-2 pt-1">
            <span className="text-[10px] px-2 py-0.5 bg-[#1877F2] text-white rounded font-medium">
              {version.cta || 'קנה עכשיו'}
            </span>
          </div>
        </div>
      </div>

      {/* Instagram Preview */}
      <div className="bg-[#1a1a2e] border border-[#2a2a4a] rounded-xl overflow-hidden">
        <div className="px-4 py-2 border-b border-[#2a2a4a] flex items-center gap-2">
          <div className="w-6 h-6 rounded-full bg-gradient-to-br from-[#F58529] via-[#DD2A7B] to-[#8134AF] flex items-center justify-center text-white text-[10px] font-bold">IG</div>
          <span className="text-xs font-medium">Instagram Ad Preview</span>
        </div>

        {/* Image area — square */}
        <div className="aspect-square max-h-48 bg-gradient-to-br from-orange/20 to-pink/20 flex items-center justify-center">
          {version.imageUrl ? (
            <img src={version.imageUrl} alt={matchName} className="w-full h-full object-cover" />
          ) : (
            <span className="text-3xl opacity-40">📸</span>
          )}
        </div>

        {/* Caption */}
        <div className="p-4">
          <p className="text-xs text-text-dim leading-relaxed line-clamp-4">
            {ig?.caption || `${version.headline}\n${version.body}\n${version.cta}`}
          </p>
        </div>
      </div>
    </div>
  );
}
