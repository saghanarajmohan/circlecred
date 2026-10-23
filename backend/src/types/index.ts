export interface HealthCheckResponse {
  status: string;
  message: string;
  timestamp: string;
}

export type PaymentStatus = 'pending' | 'successful' | 'failed';

export interface ScoreFactor {
  key: string;
  label: string;
  value: number;
  weight: number;
  points: number;
  detail: string;
}
