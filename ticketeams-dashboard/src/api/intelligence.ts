import { apiClient } from './client';
import type { IntelligenceReport, ScoredEvent, HeatDetail } from '../types/api';

export async function getDailyReport(date: string): Promise<IntelligenceReport> {
  const { data } = await apiClient.get(`/api/intelligence/daily/${encodeURIComponent(date)}`);
  return data;
}

export async function getHeatScores(): Promise<ScoredEvent[]> {
  const { data } = await apiClient.get('/api/intelligence/heat');
  return data;
}

export async function getHeatDetail(eventKey: string): Promise<HeatDetail> {
  const { data } = await apiClient.get(`/api/intelligence/heat/${encodeURIComponent(eventKey)}`);
  return data;
}

export async function triggerScan(): Promise<{ status: string }> {
  const { data } = await apiClient.post('/api/intelligence/scan');
  return data;
}

export async function sendReport(): Promise<{ status: string }> {
  const { data } = await apiClient.post('/api/intelligence/send-report');
  return data;
}
