import { apiClient } from './client';

// ============================================================
// Types
// ============================================================

export interface SEOCreatedItem {
  matchKey: string;
  type: 'landing_page' | 'blog_post';
  wpPageId?: number;
  wpPostId?: number;
  wpUrl: string;
  title: string;
  createdAt: string;
  aiGenerated?: boolean;
}

export interface WPContentItem {
  id: number;
  title: string;
  slug: string;
  link: string;
  status: string;
  date: string;
}

export interface SEOContentResponse {
  created: SEOCreatedItem[];
  wordpress: {
    pages: WPContentItem[];
    posts: WPContentItem[];
    totalPages: number;
    totalPosts: number;
  };
}

export interface SitemapEntry {
  name: string;
  url: string;
  count: number;
  lastmod: string | null;
}

export interface SEOHealthResponse {
  totalUrls: number;
  sitemaps: SitemapEntry[];
  robotsTxt: string;
  createdByAgent: number;
}

export interface LandingPageRequest {
  homeTeam: string;
  awayTeam: string;
  competition?: string;
  gameDate?: string;
  priceRange?: string;
}

export interface BlogPostRequest {
  topic: string;
  keywords?: string[];
  eventData?: {
    homeTeam: string;
    awayTeam: string;
    competition?: string;
    gameDate?: string;
  };
}

export interface SEOActionResult {
  success: boolean;
  pageId?: number;
  postId?: number;
  url?: string;
  title?: string;
  reason?: string;
  cached?: boolean;
}

// ============================================================
// API calls
// ============================================================

export async function getSEOContent(): Promise<SEOContentResponse> {
  const { data } = await apiClient.get('/api/seo/content');
  return data;
}

export async function getSEOHealth(): Promise<SEOHealthResponse> {
  const { data } = await apiClient.get('/api/seo/health');
  return data;
}

export async function createLandingPage(req: LandingPageRequest): Promise<SEOActionResult> {
  const { data } = await apiClient.post('/api/seo/landing-page', req);
  return data;
}

export async function createBlogPost(req: BlogPostRequest): Promise<SEOActionResult> {
  const { data } = await apiClient.post('/api/seo/blog-post', req);
  return data;
}
