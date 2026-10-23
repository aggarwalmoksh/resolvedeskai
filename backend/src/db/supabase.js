import { createClient } from '@supabase/supabase-js';
import ws from 'ws';
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from '../config.js';

let supabaseClient = null;

if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
  try {
    supabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      },
      realtime: { transport: ws }
    });
  } catch (err) {
    console.error('Failed to initialize Supabase client:', err.message);
  }
} else {
  console.warn('⚠️ SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing in config.');
}

export const supabase = supabaseClient;
