import express from 'express';
import cors from 'cors';
import { config } from './config/env';
import healthRoutes from './routes/healthRoutes';

const app = express();

app.use(cors({
  origin: config.clientUrl,
  credentials: true,
}));
app.use(express.json());

// Routes
app.use('/api', healthRoutes);

app.listen(config.port, () => {
  console.log(`[CircleCred API] Server running on port ${config.port} in ${config.nodeEnv} mode`);
  console.log(`[CircleCred API] Health endpoint available at http://localhost:${config.port}/api/health`);
});

export default app;
