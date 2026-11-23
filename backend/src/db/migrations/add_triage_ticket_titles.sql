create function public.finish_ticket_triage_with_title(
  p_org_id uuid, p_complaint_id uuid, p_lease uuid, p_title text, p_category text, p_priority text, p_retry boolean
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
    set title = coalesce(nullif(left(trim(p_title), 80), ''), title),
        category = case when category_manually_set then category else p_category end,
        priority = case when priority_manually_set then priority else p_priority end,
        updated_at = now()
    where org_id = p_org_id and id = p_complaint_id and not isolation_review_required
      and status in ('pending', 'in_progress')
      and ((nullif(left(trim(p_title), 80), '') is not null and title is distinct from left(trim(p_title), 80))
        or (not category_manually_set and category is distinct from p_category)
        or (not priority_manually_set and priority is distinct from p_priority));
end;
$$;

revoke all on function public.finish_ticket_triage_with_title(uuid, uuid, uuid, text, text, text, boolean)
  from public, anon, authenticated;
grant execute on function public.finish_ticket_triage_with_title(uuid, uuid, uuid, text, text, text, boolean)
  to service_role;

-- Recover a title from the earliest substantive customer message on older tickets.
with legacy as (
  select c.org_id, c.id, (
    select trim(part.text) from public.complaint_messages m
    cross join lateral string_to_table(m.message_text, E'\n---\n[Update]: ') with ordinality as part(text, position)
    where m.org_id = c.org_id and m.complaint_id = c.id and m.sender_type = 'customer'
      and trim(part.text) <> ''
      and trim(part.text) !~* '^/'
      and trim(part.text) !~* '^(hi+|hey+|hello+|hlo+|hloo+|helo+|namaste|good (morning|afternoon|evening))[[:space:]!.,?👋]*$'
    order by m.created_at, m.id, part.position limit 1
  ) as issue
  from public.complaints c
  where not c.isolation_review_required
    and (trim(c.title) ~* '^/start([@[:space:]]|$)'
      or trim(c.title) ~* '^(hi+|hey+|hello+|hlo+|hloo+|helo+|namaste|good (morning|afternoon|evening))[[:space:]!.,?👋]*$')
)
update public.complaints c
set title = coalesce(left(regexp_replace(legacy.issue, '[[:space:]]+', ' ', 'g'), 80), 'Support request • ' || c.ticket_number),
    priority = case when legacy.issue is null and not c.priority_manually_set then 'low' else c.priority end
from legacy
where c.org_id = legacy.org_id and c.id = legacy.id;
