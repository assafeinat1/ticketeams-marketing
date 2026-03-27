import { apiClient } from './client';
import type { WeeklyFinanceReport, CampaignFinance, ChannelPerformance, BudgetRecommendation, FinanceAlert } from '../types/api';

export async function getWeeklyReport(weekStart: string): Promise<WeeklyFinanceReport> {
  const { data } = await apiClient.get(`/api/finance/weekly/${encodeURIComponent(weekStart)}`, { timeout: 60000 });
  return data;
}

export async function getEventFinance(eventName: string): Promise<CampaignFinance> {
  const { data } = await apiClient.get(`/api/finance/event/${encodeURIComponent(eventName)}`);
  return data;
}

export async function getCampaignFinance(campaignName: string): Promise<CampaignFinance> {
  const { data } = await apiClient.get(`/api/finance/campaign/${encodeURIComponent(campaignName)}`);
  return data;
}

export async function getChannels(): Promise<ChannelPerformance[]> {
  const { data } = await apiClient.get('/api/finance/channels');
  return data;
}

export async function getBudgetRecommendations(): Promise<BudgetRecommendation[]> {
  const { data } = await apiClient.get('/api/finance/budget-recommendation');
  return data;
}

export async function getAlerts(): Promise<FinanceAlert[]> {
  const { data } = await apiClient.get('/api/finance/alerts');
  return data;
}

export async function sendFinanceReport(): Promise<{ status: string }> {
  const { data } = await apiClient.post('/api/finance/send-report');
  return data;
}
