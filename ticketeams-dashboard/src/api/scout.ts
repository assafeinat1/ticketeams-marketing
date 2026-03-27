import { apiClient } from './client';
import type { ProactiveScanResult, DemandScoreResult, PushToMondayResponse } from '../types/api';

export async function getProactiveScan(): Promise<ProactiveScanResult> {
  const { data } = await apiClient.get('/api/proactive-scan');
  return data;
}

export async function getDemandScore(
  home: string,
  away: string,
  competition?: string,
): Promise<DemandScoreResult> {
  const params = new URLSearchParams();
  if (competition) params.set('competition', competition);
  const qs = params.toString();
  const { data } = await apiClient.get(
    `/api/demand/${encodeURIComponent(home)}/${encodeURIComponent(away)}${qs ? `?${qs}` : ''}`
  );
  return data;
}

export async function triggerProactiveScan(): Promise<void> {
  await apiClient.post('/trigger-proactive-scan');
}

export async function pushToMonday(data: {
  matchKey: string;
  homeTeam: string;
  awayTeam: string;
  competition: string;
  date: string;
}): Promise<PushToMondayResponse> {
  const { data: result } = await apiClient.post('/api/scout/push-to-monday', data);
  return result;
}
