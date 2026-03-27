import { apiClient } from './client';
import type { BIReport, StockData } from '../types/api';

export async function getBIReport(): Promise<BIReport> {
  const { data } = await apiClient.get('/api/bi-report');
  return data;
}

export async function getStockStatus(matchKey: string): Promise<StockData> {
  const { data } = await apiClient.get(`/api/cmo/stock/${encodeURIComponent(matchKey)}`);
  return data;
}

export async function getStockOverview(): Promise<StockData[]> {
  const { data } = await apiClient.get('/api/cmo/stock-overview');
  return data;
}
