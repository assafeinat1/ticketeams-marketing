import { apiClient } from './client';
import type { AgentKey, ChatRequest, ChatResponse } from '../types/api';

export async function sendChatMessage(request: ChatRequest): Promise<ChatResponse> {
  const { data } = await apiClient.post('/api/agent-chat', request, { timeout: 60000 });
  return data;
}

export interface AgentMemoryEntry {
  category: string;
  detail: string;
  preference?: string;
  timestamp: string;
}

export interface AgentMemory {
  corrections: AgentMemoryEntry[];
  preferences: AgentMemoryEntry[];
  lastUpdated: string | null;
}

export async function getAgentMemory(agent: AgentKey): Promise<AgentMemory> {
  const { data } = await apiClient.get(`/api/agent-memory/${agent}`);
  return data;
}

export async function deleteAgentMemoryEntry(agent: AgentKey, index: number): Promise<void> {
  await apiClient.delete(`/api/agent-memory/${agent}/${index}`);
}
