import { supabase } from './supabase.js';
import { fingerprintToken, protectBotToken } from '../services/botSecrets.js';

try {
  fingerprintToken('');
  let migrated = 0;
  const schemaDeadline = Date.now() + 30_000;
  while (true) {
    const { data: rows, error } = await supabase.from('bots')
      .select('id, org_id, bot_token').is('bot_token_fingerprint', null).order('id').limit(100);
    if (error) {
      if (['PGRST204', '42703'].includes(error.code) && Date.now() < schemaDeadline) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        continue;
      }
      throw error;
    }
    if (!rows.length) break;
    for (const bot of rows) {
      const { error: updateError } = await supabase.from('bots')
        .update(protectBotToken(bot.bot_token, bot)).eq('id', bot.id).eq('org_id', bot.org_id)
        .is('bot_token_fingerprint', null);
      if (updateError) throw updateError;
      migrated++;
    }
  }
  console.log(`Migrated ${migrated} bot credentials.`);
} catch (error) {
  console.error('Bot credential migration failed.', error.code || error.name);
  process.exitCode = 1;
}
