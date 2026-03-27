import { apiClient } from './client';
import type { AdMonitorResult, PublishCampaignResponse, CompetitorAdResult, MetaCampaign, MetaTokenStatus } from '../types/api';

export async function getAdMonitor(date: string): Promise<AdMonitorResult> {
  const { data } = await apiClient.get(`/api/ad-monitor/${date}`);
  return data;
}

export async function triggerAdMonitor(date?: string): Promise<void> {
  await apiClient.post('/trigger-ad-monitor', { date });
}

export async function triggerRimaCampaign(): Promise<void> {
  await apiClient.post('/trigger-rima-campaign');
}

export async function publishCampaign(matchKey: string): Promise<PublishCampaignResponse> {
  const { data } = await apiClient.post('/api/meta/publish', { matchKey });
  return data;
}

export async function getCompetitorAds(searchTerms?: string[]): Promise<CompetitorAdResult> {
  const params: Record<string, string> = {};
  if (searchTerms?.length) params.q = searchTerms.join(',');
  const { data } = await apiClient.get('/api/meta/competitors', { params });
  return data;
}

export async function getMetaCampaigns(): Promise<MetaCampaign[]> {
  const { data } = await apiClient.get('/api/meta/campaigns');
  return data;
}

export async function getTokenStatus(): Promise<MetaTokenStatus> {
  const { data } = await apiClient.get('/api/meta/token-status');
  return data;
}
