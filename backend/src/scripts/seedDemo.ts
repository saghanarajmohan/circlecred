import { config } from '../config/env';
import { getDatabase, initializeDatabase } from '../services/database';
import { seedDemoData } from '../services/demoData';

if (config.nodeEnv !== 'development' || !process.argv.includes('--confirm-demo-seed')) {
  console.error('Demo fixtures require NODE_ENV=development and the explicit --confirm-demo-seed flag.');
  process.exitCode = 1;
} else {
  initializeDatabase();
  const userCount=(getDatabase().prepare('SELECT COUNT(*) AS count FROM users').get() as {count:number}).count;
  if (userCount > 0) {
    console.error('Refusing to add demo fixtures to a database that already contains users. Back up data and choose a separate empty DATABASE_PATH.');
    process.exitCode = 1;
  } else {
    seedDemoData();
    console.log(`Optional CircleCred demo fixtures inserted into ${config.databasePath}.`);
  }
}
