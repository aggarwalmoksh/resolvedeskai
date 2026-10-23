import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Check possible locations for .env (root workspace or backend folder)
const candidatePaths = [
  path.resolve(__dirname, '../../.env'),
  path.resolve(__dirname, '../.env'),
  path.resolve(process.cwd(), '.env'),
  path.resolve(process.cwd(), '../.env')
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
export const ENFORCE_SECRET_TOKEN = process.env.ENFORCE_SECRET_TOKEN === '1' || process.env.ENFORCE_SECRET_TOKEN === 'true';
export const LOADED_ENV_PATH = envPath;
