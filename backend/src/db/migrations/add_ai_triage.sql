alter table public.complaints
  add column category_manually_set boolean not null default false,
  add column priority_manually_set boolean not null default false;

create table public.ticket_triage_jobs (
  org_id uuid not null,
  complaint_id uuid not null,
  message_id uuid not null,
  available_at timestamptz not null default now(),
  lease uuid,
  attempts integer not null default 0,
  primary key (org_id, complaint_id),
  foreign key (org_id, complaint_id) references public.complaints (org_id, id) on delete cascade,
  foreign key (message_id) references public.complaint_messages (id) on delete cascade
);
create index ticket_triage_ready on public.ticket_triage_jobs (available_at);
alter table public.ticket_triage_jobs enable row level security;
revoke all on public.ticket_triage_jobs from public, anon, authenticated;
grant select, insert, update, delete on public.ticket_triage_jobs to service_role;

create function public.enqueue_ticket_triage() returns trigger
language plpgsql set search_path = '' as $$
begin
  insert into public.ticket_triage_jobs as job (org_id, complaint_id, message_id)
  select new.org_id, new.complaint_id, new.id
  from public.complaints c
  where c.org_id = new.org_id and c.id = new.complaint_id
    and not c.isolation_review_required
    and not (c.category_manually_set and c.priority_manually_set)
  on conflict (org_id, complaint_id) do update
    set message_id = excluded.message_id, available_at = now(), lease = null, attempts = 0;
  return new;
end;
$$;

create trigger enqueue_ticket_triage after insert on public.complaint_messages
for each row when (new.sender_type = 'customer' and new.telegram_message_id is not null)
execute function public.enqueue_ticket_triage();

create function public.claim_ticket_triage() returns jsonb
language plpgsql set search_path = '' as $$
declare
  job public.ticket_triage_jobs%rowtype;
  latest_text text;
  opening_text text;
begin
  select * into job from public.ticket_triage_jobs
    where available_at <= now()
    order by available_at for update skip locked limit 1;
  if not found then return null; end if;

  update public.ticket_triage_jobs
    set lease = gen_random_uuid(), available_at = now() + interval '1 minute', attempts = attempts + 1
    where org_id = job.org_id and complaint_id = job.complaint_id
    returning * into job;

  select m.message_text into latest_text
    from public.complaint_messages m join public.complaints c
      on c.id = m.complaint_id and c.org_id = m.org_id
    where m.id = job.message_id and m.complaint_id = job.complaint_id and m.org_id = job.org_id
      and not c.isolation_review_required and c.status in ('pending', 'in_progress')
      and not (c.category_manually_set and c.priority_manually_set);
  if latest_text is not null then
    select m.message_text into opening_text from public.complaint_messages m
      where m.org_id = job.org_id and m.complaint_id = job.complaint_id and m.sender_type = 'customer'
      order by m.created_at, m.id limit 1;
  end if;
  return jsonb_build_object('org_id', job.org_id, 'complaint_id', job.complaint_id,
    'lease', job.lease, 'attempts', job.attempts, 'latest_text', latest_text, 'opening_text', opening_text);
end;
$$;

create function public.finish_ticket_triage(
  p_org_id uuid, p_complaint_id uuid, p_lease uuid, p_category text, p_priority text, p_retry boolean
) returns void
language plpgsql set search_path = '' as $$
begin
  -- Lock in the same order as Telegram ingestion so stale results cannot commit after a new message.
  perform 1 from public.complaints where org_id = p_org_id and id = p_complaint_id for update;
  if not found then return; end if;

  if p_retry then
    update public.ticket_triage_jobs set lease = null,
      available_at = now() + (attempts * interval '15 seconds')
      where org_id = p_org_id and complaint_id = p_complaint_id and lease = p_lease;
    return;
  end if;

  delete from public.ticket_triage_jobs
    where org_id = p_org_id and complaint_id = p_complaint_id and lease = p_lease;
  if not found or p_category is null or p_priority is null then return; end if;
  if p_category not in ('product', 'delivery', 'billing', 'service', 'other')
    or p_priority not in ('low', 'medium', 'high', 'urgent') then
    raise exception 'Invalid ticket triage labels';
  end if;
  update public.complaints
    set category = case when category_manually_set then category else p_category end,
        priority = case when priority_manually_set then priority else p_priority end,
        updated_at = now()
    where org_id = p_org_id and id = p_complaint_id and not isolation_review_required
      and status in ('pending', 'in_progress')
      and ((not category_manually_set and category is distinct from p_category)
        or (not priority_manually_set and priority is distinct from p_priority));
end;
$$;

revoke all on function public.enqueue_ticket_triage(), public.claim_ticket_triage(),
  public.finish_ticket_triage(uuid, uuid, uuid, text, text, boolean) from public, anon, authenticated;
grant execute on function public.claim_ticket_triage(),
  public.finish_ticket_triage(uuid, uuid, uuid, text, text, boolean) to service_role;
grant execute on function public.enqueue_ticket_triage() to service_role;
