import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Backend-only environment file. Frontend public configuration lives in frontend/.env.
const candidatePaths = [
  path.resolve(__dirname, '../.env'),
  path.resolve(__dirname, '../env'),
  path.resolve(process.cwd(), '.env'),
  path.resolve(process.cwd(), 'env')
];

const envPath = candidatePaths.find(p => fs.existsSync(p));

if (envPath) {
  dotenv.config({ path: envPath });
} else {
  dotenv.config();
}

export const PORT = process.env.PORT || 4000;
export const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN?.trim();
export const SECRET_TOKEN = process.env.SECRET_TOKEN?.replace(/^["']|["']$/g, '').trim();
export const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL?.trim();
export const ECHO = process.env.ECHO === '1' || process.env.ECHO === 'true';
export const LOADED_ENV_PATH = envPath;
export const SUPABASE_URL = process.env.SUPABASE_URL?.trim();
export const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
export const CLERK_PUBLISHABLE_KEY = process.env.CLERK_PUBLISHABLE_KEY?.trim();
export const CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY?.trim();
export const FRONTEND_URL = process.env.FRONTEND_URL?.trim();
export const CORS_ORIGINS = (process.env.CORS_ORIGIN || FRONTEND_URL || '')
  .split(',')
  .map(origin => origin.trim().replace(/\/$/, ''))
  .filter(Boolean);
