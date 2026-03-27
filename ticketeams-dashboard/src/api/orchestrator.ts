import { apiClient } from './client';
import type { OrchestratorStatus, OrchestratorDecision, OrchestratorConfig, PipelineResult } from '../types/api';

export async function getStatus(): Promise<OrchestratorStatus> {
  const { data } = await apiClient.get('/api/orchestrator/status');
  return data;
}

export async function getDecisions(limit = 20): Promise<OrchestratorDecision[]> {
  const { data } = await apiClient.get(`/api/orchestrator/decisions?limit=${limit}`);
  return data;
}

export async function getConfig(): Promise<OrchestratorConfig> {
  const { data } = await apiClient.get('/api/orchestrator/config');
  return data;
}

export async function triggerHotCheck(): Promise<{ status: string }> {
  const { data } = await apiClient.post('/api/orchestrator/hot-check');
  return data;
}

export async function triggerPerfCheck(): Promise<{ status: string }> {
  const { data } = await apiClient.post('/api/orchestrator/perf-check');
  return data;
}

export async function executeDecision(decisionId: string): Promise<{ status: string }> {
  const { data } = await apiClient.post(`/api/orchestrator/execute/${encodeURIComponent(decisionId)}`);
  return data;
}

export async function setupBoard(): Promise<{ status: string; boardId?: string }> {
  const { data } = await apiClient.post('/api/orchestrator/setup-board');
  return data;
}

export async function runFullPipeline(params: { homeTeam: string; awayTeam: string; competition?: string; date?: string }): Promise<PipelineResult> {
  const { data } = await apiClient.post('/api/orchestrator/full-pipeline', params);
  return data;
}
