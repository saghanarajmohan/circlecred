import { Request, Response } from 'express';
import { HealthCheckResponse } from '../types';

export const getHealth = (_req: Request, res: Response<HealthCheckResponse>): void => {
  res.status(200).json({
    status: 'ok',
    message: 'CircleCred Backend API is healthy',
    timestamp: new Date().toISOString(),
  });
};
