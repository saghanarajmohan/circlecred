import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: Number(process.env.PORT || 5000),
  nodeEnv: process.env.NODE_ENV || 'development',
  clientUrl: process.env.CLIENT_URL || 'http://localhost:5173',
  databasePath: process.env.DATABASE_PATH || './data/circlecred-empty-v1.sqlite',
  bootstrapToken: process.env.BOOTSTRAP_TOKEN || '',
  simulatedPaymentOutcome: (process.env.SIMULATED_PAYMENT_OUTCOME === 'failed' ? 'failed' : 'successful') as 'failed' | 'successful',
};
