import express from 'express';
import cors from 'cors';
import { config } from './config/env';
import healthRoutes from './routes/healthRoutes';
import apiRoutes from './routes/apiRoutes';

const app = express();

app.use(cors({
  origin: config.clientUrl,
  credentials: true,
}));
app.use(express.json());

// Routes
app.use('/api', healthRoutes);
app.use('/api', apiRoutes);

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(error);
  if (error instanceof SyntaxError && 'body' in error) return res.status(400).json({ error: 'Request body must contain valid JSON.' });
  res.status(500).json({ error: 'An unexpected server error occurred.' });
});

app.listen(config.port, () => {
  console.log(`[CircleCred API] Server running on port ${config.port} in ${config.nodeEnv} mode`);
  console.log(`[CircleCred API] Health endpoint available at http://localhost:${config.port}/api/health`);
});

export default app;
