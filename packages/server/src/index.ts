import { config } from './config.js';
import { buildApp } from './app.js';
import { startScheduler, shutdownScheduler } from './scheduler/plan-scheduler.js';

async function main() {
  const app = await buildApp();

  try {
    await app.listen({ port: config.port, host: config.host });
    app.log.info(`Server running on http://${config.host}:${config.port}`);
    startScheduler();
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }

  const shutdown = () => {
    shutdownScheduler();
    app.close();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main();
