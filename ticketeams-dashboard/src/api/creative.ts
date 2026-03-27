import { apiClient } from './client';
import type { PendingApproval, AdVersion } from '../types/api';

export async function getPendingApprovals(): Promise<PendingApproval[]> {
  const { data } = await apiClient.get('/api/pending-approvals');
  return data;
}

export async function approveVersion(
  matchKey: string,
  selectedVersion: number,
): Promise<{
  status: string;
  matchKey: string;
  selectedVersion: number;
  pipeline?: {
    formats: { story?: boolean; square?: boolean; post?: boolean; count?: number; error?: string } | null;
    finance: {
      status?: string;
      recommendations?: number;
      error?: string;
      budgetRecommendation?: {
        recommendedDailyBudget: number;
        expectedROAS: number | null;
        recommendedDuration: number;
        recommendedTargeting: string;
        totalEstimatedBudget: number;
        daysUntilGame: number | null;
      } | null;
    } | null;
    meta: { status?: string; campaignId?: string | null; dashboardUrl?: string | null; error?: string } | null;
  };
}> {
  const { data } = await apiClient.post(`/api/approve/${encodeURIComponent(matchKey)}`, {
    selectedVersion,
  });
  return data;
}

export async function updateAdText(
  matchKey: string,
  versionIndex: number,
  updates: Partial<Pick<AdVersion, 'headline' | 'body' | 'cta'>>,
): Promise<AdVersion> {
  const { data } = await apiClient.patch(
    `/api/creative/${encodeURIComponent(matchKey)}/versions/${versionIndex}`,
    updates,
  );
  return data;
}

export async function regenerateVersion(
  matchKey: string,
  versionIndex: number,
): Promise<AdVersion> {
  const { data } = await apiClient.post('/api/creative/regenerate', {
    matchKey,
    versionIndex,
  });
  return data;
}
