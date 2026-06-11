import 'dotenv/config';

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  host: process.env.HOST || '0.0.0.0',
  encryptionSecret: process.env.ENCRYPTION_SECRET || 'dev-secret-change-in-production!!',
  jwtSecret: process.env.JWT_SECRET || 'dev-jwt-secret-change-in-production',
  databasePath: process.env.DATABASE_PATH || './data/restful-backup.db',
  resticBinary: process.env.RESTIC_BINARY || 'restic',
  maxConcurrentTasks: parseInt(process.env.MAX_CONCURRENT_TASKS || '4', 10),
};
