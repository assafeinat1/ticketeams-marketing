import { useState, useCallback } from 'react';
import { getSEOContent, getSEOHealth, createLandingPage, createBlogPost } from '../../api/seo';
import type { SEOContentResponse, SEOHealthResponse, SEOCreatedItem } from '../../api/seo';
import { usePolling } from '../../hooks/usePolling';
import { useToast } from '../../hooks/useToast';
import StatCard from '../shared/StatCard';
import SkeletonLoader from '../shared/SkeletonLoader';
import GradientButton from '../shared/GradientButton';
import AgentChat from '../chat/AgentChat';

export default function SEOTab() {
  const [content, setContent] = useState<SEOContentResponse | null>(null);
  const [health, setHealth] = useState<SEOHealthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState<'landing' | 'blog' | null>(null);
  const [showLandingForm, setShowLandingForm] = useState(false);
  const [showBlogForm, setShowBlogForm] = useState(false);
  const { showToast } = useToast();

  // Form state
  const [landingForm, setLandingForm] = useState({ homeTeam: '', awayTeam: '', competition: '', gameDate: '' });
  const [blogForm, setBlogForm] = useState({ topic: '', keywords: '', homeTeam: '', awayTeam: '', competition: '', gameDate: '' });

  const loadData = useCallback(async () => {
    try {
      const [contentRes, healthRes] = await Promise.allSettled([
        getSEOContent(),
        getSEOHealth(),
      ]);
      if (contentRes.status === 'fulfilled') setContent(contentRes.value);
      if (healthRes.status === 'fulfilled') setHealth(healthRes.value);
    } catch {
      // Backend may not be running
    } finally {
      setLoading(false);
    }
  }, []);

  usePolling(loadData, 120000);

  const handleCreateLanding = async () => {
    if (!landingForm.homeTeam || !landingForm.awayTeam) {
      showToast('error', 'חובה למלא קבוצת בית וקבוצת חוץ');
      return;
    }
    setCreating('landing');
    try {
      const result = await createLandingPage(landingForm);
      if (result.success) {
        showToast('success', `דף נחיתה נוצר: ${result.title}`);
        setShowLandingForm(false);
        setLandingForm({ homeTeam: '', awayTeam: '', competition: '', gameDate: '' });
        loadData();
      } else {
        showToast('error', result.reason || 'שגיאה ביצירת דף נחיתה');
      }
    } catch {
      showToast('error', 'שגיאה ביצירת דף נחיתה');
    } finally {
      setCreating(null);
    }
  };

  const handleCreateBlog = async () => {
    if (!blogForm.topic && !blogForm.homeTeam) {
      showToast('error', 'חובה למלא נושא או קבוצת בית');
      return;
    }
    setCreating('blog');
    try {
      const req = {
        topic: blogForm.topic,
        keywords: blogForm.keywords ? blogForm.keywords.split(',').map(k => k.trim()) : undefined,
        eventData: blogForm.homeTeam ? {
          homeTeam: blogForm.homeTeam,
          awayTeam: blogForm.awayTeam,
          competition: blogForm.competition,
          gameDate: blogForm.gameDate,
        } : undefined,
      };
      const result = await createBlogPost(req);
      if (result.success) {
        showToast('success', `פוסט נוצר: ${result.title}`);
        setShowBlogForm(false);
        setBlogForm({ topic: '', keywords: '', homeTeam: '', awayTeam: '', competition: '', gameDate: '' });
        loadData();
      } else {
        showToast('error', result.reason || 'שגיאה ביצירת פוסט');
      }
    } catch {
      showToast('error', 'שגיאה ביצירת פוסט');
    } finally {
      setCreating(null);
    }
  };

  const landingPages = content?.created.filter(c => c.type === 'landing_page') || [];
  const blogPosts = content?.created.filter(c => c.type === 'blog_post') || [];

  if (loading) return (
    <div className="space-y-5">
      <SkeletonLoader type="cards" cols={3} />
      <SkeletonLoader type="table" rows={4} />
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Stat cards */}
      <div className="grid grid-cols-3 gap-3 stat-grid-responsive">
        <StatCard label="דפי נחיתה" value={landingPages.length} color="green" />
        <StatCard label="פוסטים בבלוג" value={blogPosts.length} color="purple" />
        <StatCard label="URLים ב-Sitemap" value={health?.totalUrls || 0} color="blue" />
      </div>

      {/* Action buttons */}
      <div className="flex gap-3">
        <GradientButton onClick={() => setShowLandingForm(!showLandingForm)}>
          {showLandingForm ? 'סגור' : 'צור דף נחיתה'}
        </GradientButton>
        <GradientButton onClick={() => setShowBlogForm(!showBlogForm)}>
          {showBlogForm ? 'סגור' : 'צור פוסט בלוג'}
        </GradientButton>
        <GradientButton variant="ghost" onClick={loadData}>
          רענן
        </GradientButton>
      </div>

      {/* Landing Page Form */}
      {showLandingForm && (
        <div className="bg-card border border-border rounded-xl p-5 space-y-3">
          <h3 className="text-sm font-semibold text-text">יצירת דף נחיתה</h3>
          <div className="grid grid-cols-2 gap-3">
            <input
              className="bg-bg border border-border rounded-lg px-3 py-2 text-sm text-text placeholder-text-dim"
              placeholder="קבוצת בית *"
              value={landingForm.homeTeam}
              onChange={e => setLandingForm(p => ({ ...p, homeTeam: e.target.value }))}
            />
            <input
              className="bg-bg border border-border rounded-lg px-3 py-2 text-sm text-text placeholder-text-dim"
              placeholder="קבוצת חוץ *"
              value={landingForm.awayTeam}
              onChange={e => setLandingForm(p => ({ ...p, awayTeam: e.target.value }))}
            />
            <input
              className="bg-bg border border-border rounded-lg px-3 py-2 text-sm text-text placeholder-text-dim"
              placeholder="תחרות"
              value={landingForm.competition}
              onChange={e => setLandingForm(p => ({ ...p, competition: e.target.value }))}
            />
            <input
              className="bg-bg border border-border rounded-lg px-3 py-2 text-sm text-text placeholder-text-dim"
              type="date"
              value={landingForm.gameDate}
              onChange={e => setLandingForm(p => ({ ...p, gameDate: e.target.value }))}
            />
          </div>
          <GradientButton onClick={handleCreateLanding} disabled={creating === 'landing'}>
            {creating === 'landing' ? 'יוצר...' : 'צור דף נחיתה'}
          </GradientButton>
        </div>
      )}

      {/* Blog Post Form */}
      {showBlogForm && (
        <div className="bg-card border border-border rounded-xl p-5 space-y-3">
          <h3 className="text-sm font-semibold text-text">יצירת פוסט בלוג (AI)</h3>
          <div className="grid grid-cols-2 gap-3">
            <input
              className="bg-bg border border-border rounded-lg px-3 py-2 text-sm text-text placeholder-text-dim col-span-2"
              placeholder="נושא הפוסט (או השאר ריק ומלא קבוצות)"
              value={blogForm.topic}
              onChange={e => setBlogForm(p => ({ ...p, topic: e.target.value }))}
            />
            <input
              className="bg-bg border border-border rounded-lg px-3 py-2 text-sm text-text placeholder-text-dim col-span-2"
              placeholder="מילות מפתח (מופרדות בפסיק)"
              value={blogForm.keywords}
              onChange={e => setBlogForm(p => ({ ...p, keywords: e.target.value }))}
            />
            <input
              className="bg-bg border border-border rounded-lg px-3 py-2 text-sm text-text placeholder-text-dim"
              placeholder="קבוצת בית"
              value={blogForm.homeTeam}
              onChange={e => setBlogForm(p => ({ ...p, homeTeam: e.target.value }))}
            />
            <input
              className="bg-bg border border-border rounded-lg px-3 py-2 text-sm text-text placeholder-text-dim"
              placeholder="קבוצת חוץ"
              value={blogForm.awayTeam}
              onChange={e => setBlogForm(p => ({ ...p, awayTeam: e.target.value }))}
            />
            <input
              className="bg-bg border border-border rounded-lg px-3 py-2 text-sm text-text placeholder-text-dim"
              placeholder="תחרות"
              value={blogForm.competition}
              onChange={e => setBlogForm(p => ({ ...p, competition: e.target.value }))}
            />
            <input
              className="bg-bg border border-border rounded-lg px-3 py-2 text-sm text-text placeholder-text-dim"
              type="date"
              value={blogForm.gameDate}
              onChange={e => setBlogForm(p => ({ ...p, gameDate: e.target.value }))}
            />
          </div>
          <GradientButton onClick={handleCreateBlog} disabled={creating === 'blog'}>
            {creating === 'blog' ? 'Claude כותב...' : 'צור פוסט בלוג'}
          </GradientButton>
        </div>
      )}

      {/* Landing Pages Table */}
      <div className="bg-card border border-border rounded-xl overflow-hidden card-elevated">
        <div className="bg-bg-elevated/50 px-4 py-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-text">דפי נחיתה ({landingPages.length})</h3>
        </div>
        {landingPages.length === 0 ? (
          <div className="px-4 py-8 text-center text-text-dim text-sm">
            אין דפי נחיתה שנוצרו עדיין
          </div>
        ) : (
          <div className="divide-y divide-border/50">
            {landingPages.map((item) => (
              <ContentRow key={item.matchKey} item={item} />
            ))}
          </div>
        )}
      </div>

      {/* Blog Posts Table */}
      <div className="bg-card border border-border rounded-xl overflow-hidden card-elevated">
        <div className="bg-bg-elevated/50 px-4 py-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-text">פוסטים בבלוג ({blogPosts.length})</h3>
        </div>
        {blogPosts.length === 0 ? (
          <div className="px-4 py-8 text-center text-text-dim text-sm">
            אין פוסטים שנוצרו עדיין
          </div>
        ) : (
          <div className="divide-y divide-border/50">
            {blogPosts.map((item) => (
              <ContentRow key={item.matchKey} item={item} />
            ))}
          </div>
        )}
      </div>

      {/* Sitemap Health */}
      {health && health.sitemaps.length > 0 && (
        <div className="bg-card border border-border rounded-xl overflow-hidden card-elevated">
          <div className="bg-bg-elevated/50 px-4 py-3">
            <h3 className="text-sm font-semibold text-text">
              Sitemap ({health.totalUrls} URLs | robots.txt: {health.robotsTxt === 'ok' ? 'OK' : 'Missing'})
            </h3>
          </div>
          <div className="divide-y divide-border/50">
            {health.sitemaps.map((s) => (
              <div key={s.name} className="px-4 py-2.5 flex items-center justify-between text-sm">
                <span className="text-text-dim truncate max-w-[60%]">{s.name}</span>
                <span className="text-text font-medium">{s.count} URLs</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Agent Chat */}
      <AgentChat agent="seo" />
    </div>
  );
}

function ContentRow({ item }: { item: SEOCreatedItem }) {
  const date = item.createdAt ? new Date(item.createdAt).toLocaleDateString('he-IL') : '-';
  const wpId = item.wpPageId || item.wpPostId || '-';

  return (
    <div className="px-4 py-3 flex items-center gap-4 text-sm">
      <div className="flex-1 min-w-0">
        <p className="text-text truncate">{item.title}</p>
        <p className="text-text-dim text-xs truncate">{item.wpUrl}</p>
      </div>
      <span className="text-text-dim text-xs whitespace-nowrap">WP #{wpId}</span>
      <span className="text-text-dim text-xs whitespace-nowrap">{date}</span>
      {item.aiGenerated && (
        <span className="bg-purple/20 text-purple text-xs px-2 py-0.5 rounded-full">AI</span>
      )}
      <span className="bg-green/20 text-green text-xs px-2 py-0.5 rounded-full">draft</span>
      {item.wpUrl && (
        <a
          href={item.wpUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue text-xs hover:underline whitespace-nowrap"
        >
          פתח
        </a>
      )}
    </div>
  );
}
