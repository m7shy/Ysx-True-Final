import { apiGet } from './apiClient';

export interface FunnelMetrics {
  dmsSent: number;
  replies: number;
  callsBooked: number;
  trials: number;
  clients: number;
}

/** GET /api/analytics/summary — real lead-funnel metrics for the tenant. */
export const getFunnelMetrics = async (): Promise<FunnelMetrics> => {
  return apiGet<FunnelMetrics>('/api/analytics/summary');
};
