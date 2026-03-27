// ============================================================
// Scout API types
// ============================================================

export interface ProactiveScanResult {
  totalFixtures: number;
  highDemand: number;
  suggestions: DemandSuggestion[];
  scannedAt: string;
}

export interface DemandSuggestion {
  matchKey: string;
  homeTeam: string;
  awayTeam: string;
  competition: string;
  date: string | null;
  demandScore: number;
  demandTier: 'critical' | 'high' | 'medium' | 'low';
  reason: string;
  url: string;
}

export interface DemandScoreResult {
  homeTeam: string;
  awayTeam: string;
  score: number;
  factors: string[];
  tier: string;
}

// ============================================================
// CMO / BI types
// ============================================================

export interface BIReport {
  generatedAt: string;
  totalItems: number;
  byCompetition: Record<string, { count: number; avgLeadTimeDays: number | null }>;
  leadTime: {
    byRange: Record<string, number>;
    byCompetition: Record<string, { avgDays: number; count: number }>;
    optimal: { range: string; count: number } | null;
  };
  seasonal: {
    byMonth: Record<string, number>;
    peakMonths: { month: string; count: number }[];
    lowMonths: { month: string; count: number }[];
    avgPerMonth: number;
  };
  insights: string[];
}

// ============================================================
// Creative / Approval types
// ============================================================

export interface EventBudgetRecommendation {
  eventName: string;
  heatScore: number;
  recommendedDailyBudget: number;
  expectedROAS: number | null;
  recommendedDuration: number;
  recommendedTargeting: 'broad_prospecting' | 'purchase_lookalike' | 'remarketing';
  totalEstimatedBudget: number;
  daysUntilGame: number | null;
}

export interface PendingApproval {
  matchKey: string;
  createdAt: string;
  status: string;
  selectedVersion?: number;
  approvedAt?: string;
  versions: AdVersion[];
  pricingReport: PricingReport | null;
  budgetRecommendation?: EventBudgetRecommendation;
  metaCampaign?: {
    campaignId: string;
    status: string;
    dashboardUrl?: string;
  };
}

export interface AdVersion {
  index: number;
  style: string;
  headline: string;
  body: string;
  cta: string;
  imageUrl?: string;
  meta: {
    style: string;
    facebook: { headline: string; primary_text: string; description: string };
    instagram: { caption: string };
  };
}

export interface PricingReport {
  homeTeam: string;
  awayTeam: string;
  competition: string;
  date: string;
  matchKey?: string;
  currency?: string;
  recommendations?: Array<{
    category: string;
    live: { price: number | null; currency: string | null };
    recommended: { price: number | null; currency: string | null };
  }>;
  heatScore?: number;
  suggestedBudget?: number;
  eventName?: string;
}

// ============================================================
// Meta Campaign & Token types
// ============================================================

export interface MetaCampaign {
  matchKey: string;
  campaignId: string;
  campaignName: string;
  status: string;
  adSets: number;
  warnings: string[];
  createdAt: string;
  metaDashboardUrl?: string;
}

export interface MetaTokenStatus {
  valid: boolean;
  expiresAt: string | null;
  daysRemaining: number | null;
  scopes: string[];
  appId: string | null;
  userId: string | null;
  type: string | null;
  error?: string;
}

// ============================================================
// Meta / Ad Monitor types
// ============================================================

export interface AdMonitorResult {
  monitorKey: string;
  date: string;
  competitors: CompetitorReport[];
  totalAds: number;
  summary: { stadium: number; human: number; urgency: number; unknown: number };
  counterAdCandidates: Array<{
    competitor: string;
    format_type: string;
    homeTeam: string;
    awayTeam: string;
  }>;
  generatedAt: string;
}

export interface CompetitorReport {
  page_id: string | null;
  page_name: string;
  ads_count: number;
  ads: CompetitorAd[];
  status: string;
}

export interface CompetitorAd {
  delivery_start: string;
  body: string;
  title: string;
  description: string;
  page_name: string;
  match_info: {
    matched: boolean;
    homeTeam: string | null;
    awayTeam: string | null;
  };
  classification: {
    format_type: string;
    reasoning: string;
  };
}

// ============================================================
// Tab type
// ============================================================

export type TabKey = 'home' | 'scout' | 'cmo' | 'creative' | 'intelligence' | 'finance' | 'meta' | 'orchestrator' | 'seo';

// ============================================================
// Interactive Control Room types
// ============================================================

export interface PushToMondayResponse {
  success: boolean;
  mondayItemId?: string;
}

export interface StockData {
  matchKey: string;
  status: 'in_stock' | 'low_stock' | 'out_of_stock' | 'unavailable';
  quantity?: number | null;
  totalCategories: number;
  inStockCategories: number;
  categories?: Array<{
    name: string;
    price: number;
    currency: string;
    inStock: boolean;
    maxQty: number | null;
  }>;
  lastChecked: string;
}

export interface PublishCampaignResponse {
  success: boolean;
  campaignId?: string;
  error?: string;
}

// ============================================================
// Competitor Ads (Meta Ad Library)
// ============================================================

export interface ApiBlindCompetitor {
  name: string;
  name_he: string;
  page_id: string;
  adLibraryUrl: string;
}

export interface CompetitorAdResult {
  totalAds: number;
  searchTerms: string[];
  competitorPages?: Array<{ name: string; page_id: string }>;
  sources?: Array<{ label: string; count: number; status: string; error: string | null }>;
  ads: CompetitorAdEntry[];
  apiBlindCompetitors?: ApiBlindCompetitor[];
  scannedAt: string;
}

export interface CompetitorAdEntry {
  delivery_start: string;
  body: string;
  title: string;
  description: string;
  page_name: string;
  page_id?: string;
  snapshot_url?: string;
  match_info: {
    matched: boolean;
    homeTeam: string | null;
    awayTeam: string | null;
    confidence?: string;
  };
  classification: {
    format_type: string;
    reasoning: string;
  };
}

// ============================================================
// Intelligence types
// ============================================================

export interface IntelligenceReport {
  date: string;
  eventsScored: number;
  topEvents: ScoredEvent[];
  sources: Record<string, { status: string; count: number }>;
  generatedAt: string;
}

export interface ScoredEvent {
  homeTeam: string;
  awayTeam: string;
  competition?: string;
  date?: string;
  eventDate?: string;
  score: number;
  tier: string;
  breakdown?: Record<string, number>;
  activeSources: string[] | number;
}

export interface HeatDetail {
  eventKey: string;
  homeTeam: string;
  awayTeam: string;
  competition: string;
  date: string;
  score: number;
  tier: string;
  breakdown: Record<string, number>;
  sources: string[];
  lastUpdated: string;
}

// ============================================================
// Finance types
// ============================================================

export interface WeeklyFinanceReport {
  weekStart: string;
  weekEnd: string;
  executiveSummary: {
    totalRevenue: number;
    totalProfit: number;
    netMarginPct: number;
    dealCount: number;
    allTimeTotalRevenue: number;
    allTimeTotalProfit: number;
    allTimeDealCount: number;
    summaryText: string;
  };
  campaignPerformance: CampaignFinance[];
  channelPerformance: ChannelPerformance[];
  alerts: FinanceAlert[];
  budgetRecommendations: BudgetRecommendation[];
}

export interface CampaignFinance {
  campaignName: string;
  adSpend: number;
  totalRevenue: number;
  totalProfit: number;
  roas: number | null;
  dealCount: number;
}

export interface ChannelPerformance {
  channel: string;
  channelLabel: string;
  revenue: number;
  totalRevenue: number;
  profit: number;
  totalProfit: number;
  dealCount: number;
  pctOfTotal: number;
  pctOfRevenue: number;
  avgRevenuePerDeal: number;
}

export interface BudgetRecommendation {
  campaignName: string;
  recommendation: string;
  roas: number;
  adSpend: number;
  suggestedSpend: number;
  reason: string;
}

export interface FinanceAlert {
  type: string;
  severity: string;
  message: string;
  data?: unknown;
  timestamp: string;
}

// ============================================================
// Orchestrator types
// ============================================================

export interface OrchestratorStatus {
  status: string;
  boardConfigured: boolean;
  approvalBoardConfigured: boolean;
  approvalBoardId: string | null;
  pendingApprovals: number;
  cachedDecisions: number;
  lastRun: string | null;
  lastHotCheck?: string;
  lastPerfCheck?: string;
  recentDecisionCount: number;
  uptime: string;
  scheduling: Record<string, string>;
  thresholds: Record<string, number | boolean | number[]>;
}

export interface OrchestratorDecision {
  id: string;
  type: string;
  priority: string;
  requiresApproval: boolean;
  event?: { homeTeam: string; awayTeam: string; competition: string; date: string; score: number };
  campaign?: { name: string; roas: number; adSpend: number };
  suggestedAction: {
    action: string;
    reasoning: string;
    suggestedBudgetILS?: number;
    campaignId?: string;
  };
  status: string;
  createdAt: string;
}

export interface OrchestratorConfig {
  scheduling: Record<string, string>;
  budgetDefaults: { baseDailyBudget: number; hotEventMultiplier: number; onFireMultiplier: number; currency: string };
  decisionRules: { thresholds: Record<string, number | boolean | number[]> };
}

export interface PipelineResult {
  success: boolean;
  matchKey: string;
  steps: string[];
  durationMs: number;
}

// ============================================================
// Agent Chat types
// ============================================================

export type AgentKey = 'intelligence' | 'finance' | 'creative' | 'scout' | 'cmo' | 'meta' | 'orchestrator' | 'seo';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  agent?: AgentKey;
  sources?: Array<{ agent: AgentKey; description: string }>;
  actions?: Array<{ type: string; data: unknown }>;
  timestamp: string;
}

export interface ChatRequest {
  agent: AgentKey;
  message: string;
  conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>;
  context?: Record<string, unknown>;
}

export interface ChatResponse {
  reply: string;
  sources: Array<{ agent: AgentKey; description: string }>;
  actions: Array<{ type: string; data: unknown }>;
  styleMemory?: { saved: boolean; note: string };
}
