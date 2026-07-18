import { apiGet } from './apiClient';

export interface FunnelMetrics {
  dmsSent: number;
  replies: number;
  callsBooked: number;
  trials: number;
  clients: number;
  /** Campaign recipients actually mailed at least once in the window. */
  sent: number;
  opened: number;
  clicked: number;
  bounced: number;
}

/**
 * GET /api/analytics/summary — real funnel + engagement metrics for the
 * tenant. Pass days (7/30/90) to window the counts; omit for all-time.
 */
export const getFunnelMetrics = async (days?: number): Promise<FunnelMetrics> => {
  const qs = days && days > 0 ? `?days=${Math.floor(days)}` : '';
  return apiGet<FunnelMetrics>(`/api/analytics/summary${qs}`);
};
