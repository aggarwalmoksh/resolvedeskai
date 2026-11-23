import { supabase } from '../db/supabase.js';
import { classifyComplaint } from './azureTriage.js';

const maxAttempts = 3;

export function startTriageWorker() {
  if (process.env.AI_TRIAGE_ENABLED !== 'true') return () => {};
  if (!supabase || !process.env.AZURE_OPENAI_BASE_URL ||
      !process.env.AZURE_OPENAI_DEPLOYMENT || !process.env.AZURE_OPENAI_API_KEY) {
    console.error('AI triage is enabled but Azure or Supabase configuration is incomplete.');
    return () => {};
  }

  let stopped = false;
  let timer;
  async function processNext() {
    let delay = 1500;
    try {
      const { data: job, error } = await supabase.rpc('claim_ticket_triage');
      if (error) throw error;
      if (job) {
        await finishJob(job);
        delay = 0;
      }
    } catch (error) {
      console.error('AI triage queue unavailable.', error.code || error.name);
      delay = 30_000;
    } finally {
      if (!stopped) {
        timer = setTimeout(processNext, delay);
        timer.unref();
      }
    }
  }

  void processNext();
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}

async function finishJob(job) {
  let result;
  let retry = false;
  if (job.latest_text?.trim() && job.attempts <= maxAttempts) {
    const latest = job.latest_text.slice(0, 4000);
    const opening = job.opening_text?.slice(0, 2000);
    const text = opening && job.opening_text !== job.latest_text
      ? `Opening complaint:\n${opening}\n\nLatest customer message:\n${latest}`
      : latest;
    try {
      result = await classifyComplaint(text);
    } catch (error) {
      const transient = error.status === 429 || error.status >= 500 ||
        error.name === 'TimeoutError' || error.message === 'fetch failed';
      retry = transient && job.attempts < maxAttempts;
      console.warn('Azure triage attempt failed.', error.status || error.name);
    }
  }
  const { error } = await supabase.rpc('finish_ticket_triage_with_title', {
    p_org_id: job.org_id,
    p_complaint_id: job.complaint_id,
    p_lease: job.lease,
    p_title: result?.title ?? null,
    p_category: result?.category ?? null,
    p_priority: result?.priority ?? null,
    p_retry: retry,
  });
  if (error) throw error;
}
