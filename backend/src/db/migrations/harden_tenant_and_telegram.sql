begin;

-- Clerk identities access data through the API. Direct browser roles have no table grants.
alter table public.organizations enable row level security;
alter table public.users enable row level security;
alter table public.bots enable row level security;
alter table public.customers enable row level security;
alter table public.complaints enable row level security;
alter table public.complaint_messages enable row level security;
alter table public.invitations enable row level security;
revoke all on public.organizations, public.users, public.bots, public.customers,
  public.complaints, public.complaint_messages, public.invitations from public, anon, authenticated;

alter table public.complaints add column if not exists collaborator_ids uuid[] not null default '{}';
alter table public.bots alter column bot_token type text;
alter table public.bots add column bot_token_fingerprint text unique;
alter table public.bots add column masked_token text;
alter table public.bots add constraint bots_encrypted_token
  check (bot_token like 'v1.%' and bot_token_fingerprint is not null and masked_token is not null) not valid;

alter table public.bots add constraint bots_org_id_id_key unique (org_id, id);
alter table public.customers add constraint customers_org_id_id_key unique (org_id, id);
alter table public.users add constraint users_org_id_id_key unique (org_id, id);
alter table public.complaints add constraint complaints_org_id_id_key unique (org_id, id);
-- Keep legacy tickets with ambiguous ownership and their message history in place.
-- Record their original references privately and detach them before validating tenant keys.
create schema if not exists resolvedesk_private;
revoke all on schema resolvedesk_private from public, anon, authenticated, service_role;
create table resolvedesk_private.ticket_isolation_review (
  complaint_id uuid primary key,
  org_id uuid not null,
  original_bot_id uuid,
  original_customer_id uuid,
  original_assignee_id uuid,
  recorded_at timestamptz not null default now()
);
revoke all on resolvedesk_private.ticket_isolation_review from public, anon, authenticated, service_role;

alter table public.complaints
  add column isolation_review_required boolean not null default false,
  alter column bot_id drop not null,
  alter column customer_id drop not null;

insert into resolvedesk_private.ticket_isolation_review
  (complaint_id, org_id, original_bot_id, original_customer_id, original_assignee_id)
select c.id, c.org_id, c.bot_id, c.customer_id, c.assigned_to
from public.complaints c
where not exists (select 1 from public.bots b where b.id = c.bot_id and b.org_id = c.org_id)
   or not exists (select 1 from public.customers p where p.id = c.customer_id and p.org_id = c.org_id);

update public.complaints c set
  isolation_review_required = true, bot_id = null, customer_id = null, assigned_to = null,
  collaborator_ids = '{}'
from resolvedesk_private.ticket_isolation_review review
where c.id = review.complaint_id and c.org_id = review.org_id;

update public.complaints c set assigned_to = null
where c.assigned_to is not null
  and not exists (select 1 from public.users u where u.id = c.assigned_to and u.org_id = c.org_id);

do $$
declare quarantined bigint;
begin
  select count(*) into quarantined from resolvedesk_private.ticket_isolation_review;
  raise notice 'Tickets held for tenant isolation review: %', quarantined;
end;
$$;

alter table public.complaints add constraint complaints_active_tenant_references
  check (isolation_review_required or (bot_id is not null and customer_id is not null));

alter table public.complaints
  add constraint complaints_org_bot_fkey foreign key (org_id, bot_id) references public.bots (org_id, id) on delete cascade,
  add constraint complaints_org_customer_fkey foreign key (org_id, customer_id) references public.customers (org_id, id) on delete cascade,
  add constraint complaints_org_assignee_fkey foreign key (org_id, assigned_to) references public.users (org_id, id) on delete set null (assigned_to),
  add column telegram_chat_id bigint;

alter table public.complaint_messages add column org_id uuid;
update public.complaint_messages m set org_id = c.org_id from public.complaints c where c.id = m.complaint_id and m.org_id is null;
alter table public.complaint_messages alter column org_id set not null;
alter table public.complaint_messages add constraint messages_org_complaint_fkey
  foreign key (org_id, complaint_id) references public.complaints (org_id, id) on delete cascade;

-- Clear stale collaborator IDs left by removed members. Reject future cross-org references.
update public.complaints c set collaborator_ids = array(
  select member_id from unnest(c.collaborator_ids) with ordinality as entry(member_id, position)
  join public.users u on u.id = entry.member_id and u.org_id = c.org_id order by entry.position
) where exists (
  select 1 from unnest(c.collaborator_ids) as entry(member_id)
  where not exists (select 1 from public.users u where u.id = entry.member_id and u.org_id = c.org_id)
);

create function public.check_ticket_collaborator_org() returns trigger
language plpgsql set search_path = '' as $$
declare member_id uuid;
begin
  for member_id in select distinct id from unnest(new.collaborator_ids) as entry(id) order by id loop
    perform 1 from public.users u where u.id = member_id and u.org_id = new.org_id for key share;
    if not found then
      raise foreign_key_violation using message = 'Collaborators must belong to the ticket organization.';
    end if;
  end loop;
  return new;
end;
$$;
create trigger check_ticket_collaborator_org before insert or update of org_id, collaborator_ids on public.complaints
  for each row execute function public.check_ticket_collaborator_org();

create function public.remove_ticket_collaborator() returns trigger
language plpgsql set search_path = '' as $$
begin
  update public.complaints set collaborator_ids = array_remove(collaborator_ids, old.id)
    where org_id = old.org_id and collaborator_ids @> array[old.id];
  return old;
end;
$$;
create trigger remove_ticket_collaborator before delete on public.users
  for each row execute function public.remove_ticket_collaborator();

create table public.workspace_revisions (
  org_id uuid primary key references public.organizations(id) on delete cascade,
  revision bigint not null default 1
);

create function public.bump_workspace_revision() returns trigger
language plpgsql set search_path = '' as $$
declare workspace_id uuid;
begin
  if TG_TABLE_NAME = 'organizations' then
    workspace_id := new.id;
  elsif TG_OP = 'DELETE' then
    workspace_id := old.org_id;
  else
    workspace_id := new.org_id;
  end if;
  -- Cascading deletes can fire after the organization itself has been removed.
  insert into public.workspace_revisions as versions (org_id)
    select id from public.organizations where id = workspace_id
    on conflict (org_id) do update set revision = versions.revision + 1;
  return null;
end;
$$;
create trigger workspace_complaint_change after insert or update or delete on public.complaints
  for each row execute function public.bump_workspace_revision();
create trigger workspace_message_change after insert or update or delete on public.complaint_messages
  for each row execute function public.bump_workspace_revision();
create trigger workspace_member_change after insert or update or delete on public.users
  for each row execute function public.bump_workspace_revision();
create trigger workspace_invitation_change after insert or update or delete on public.invitations
  for each row execute function public.bump_workspace_revision();
create trigger workspace_bot_change after insert or update or delete on public.bots
  for each row execute function public.bump_workspace_revision();
create trigger workspace_plan_change after update on public.organizations
  for each row execute function public.bump_workspace_revision();

create table public.telegram_update_inbox (
  bot_id uuid not null,
  org_id uuid not null,
  update_id bigint not null,
  payload jsonb,
  received_at timestamptz not null default now(),
  available_at timestamptz not null default now(),
  attempts integer not null default 0,
  completed_at timestamptz,
  failed_at timestamptz,
  last_error_code text,
  primary key (bot_id, update_id),
  foreign key (org_id, bot_id) references public.bots (org_id, id) on delete cascade
);
create index telegram_update_inbox_ready on public.telegram_update_inbox (available_at, received_at)
  where completed_at is null and failed_at is null;
create index telegram_ticket_lookup on public.complaints (org_id, bot_id, customer_id, telegram_chat_id, created_at desc)
  where status in ('pending', 'in_progress');

alter table public.workspace_revisions enable row level security;
alter table public.telegram_update_inbox enable row level security;
revoke all on public.workspace_revisions, public.telegram_update_inbox from public, anon, authenticated;
grant select, insert, update, delete on public.workspace_revisions, public.telegram_update_inbox to service_role;

create function public.process_telegram_update() returns jsonb
language plpgsql set search_path = '' as $$
declare
  job public.telegram_update_inbox%rowtype;
  customer public.customers%rowtype;
  ticket public.complaints%rowtype;
  chat_id bigint;
  body text;
  is_new boolean;
  result jsonb := '{}'::jsonb;
begin
  select * into job from public.telegram_update_inbox
    where completed_at is null and failed_at is null and available_at <= now()
    order by available_at, received_at for update skip locked limit 1;
  if not found then return null; end if;

  begin
    if exists (
      select 1 from public.bots b join public.organizations o on o.id = b.org_id
      where b.id = job.bot_id and b.org_id = job.org_id and b.status = 'active'
        and b.id in (
          select allowed.id from public.bots allowed where allowed.org_id = job.org_id and allowed.status = 'active'
          order by allowed.created_at, allowed.id limit o.max_bots
        )
    ) then
      insert into public.customers as current_customer
        (org_id, telegram_user_id, username, first_name, last_name, phone)
      values (job.org_id, (job.payload->>'user_id')::bigint, job.payload->>'username',
        job.payload->>'first_name', job.payload->>'last_name', job.payload->>'phone')
      on conflict (org_id, telegram_user_id) do update set
        username = excluded.username, first_name = excluded.first_name, last_name = excluded.last_name,
        phone = coalesce(excluded.phone, current_customer.phone), updated_at = now()
      returning * into customer;

      chat_id := (job.payload->>'chat_id')::bigint;
      body := job.payload->>'text';
      select * into ticket from public.complaints c
        where c.org_id = job.org_id and c.bot_id = job.bot_id and c.customer_id = customer.id
          and (c.telegram_chat_id = chat_id or (c.telegram_chat_id is null and chat_id = customer.telegram_user_id))
          and c.status in ('pending', 'in_progress')
        order by c.created_at desc limit 1 for update;
      is_new := not found;
      if is_new then
        insert into public.complaints (org_id, bot_id, customer_id, telegram_chat_id, ticket_number, title, description, category)
        values (job.org_id, job.bot_id, customer.id, chat_id, 'TICK-' || upper(left(gen_random_uuid()::text, 8)),
          case when length(body) > 50 then left(body, 47) || '...' else body end, body, job.payload->>'category')
        returning * into ticket;
      else
        update public.complaints set description = description || E'\n---\n[Update]: ' || body,
          telegram_chat_id = chat_id, updated_at = now()
          where id = ticket.id and org_id = job.org_id;
      end if;

      insert into public.complaint_messages
        (org_id, complaint_id, sender_type, sender_id, sender_name, message_text, telegram_message_id)
      values (job.org_id, ticket.id, 'customer', customer.id::text,
        coalesce(nullif(concat_ws(' ', customer.first_name, customer.last_name), ''), customer.username, 'Customer'),
        body, (job.payload->>'message_id')::bigint);

      if is_new then
        result := jsonb_build_object('bot_id', job.bot_id, 'org_id', job.org_id, 'chat_id', chat_id,
          'ticket_number', ticket.ticket_number, 'message_id', job.payload->'message_id');
      end if;
    end if;
    update public.telegram_update_inbox set completed_at = now(), payload = null
      where bot_id = job.bot_id and update_id = job.update_id and org_id = job.org_id;
    return result;
  exception when others then
    update public.telegram_update_inbox set attempts = job.attempts + 1, last_error_code = SQLSTATE,
      available_at = now() + make_interval(secs => least(300, 5 * (1 << job.attempts))),
      failed_at = case when job.attempts >= 7 then now() end
      where bot_id = job.bot_id and update_id = job.update_id and org_id = job.org_id;
    return jsonb_build_object('dead_letter', job.attempts >= 7, 'update_id', job.update_id);
  end;
end;
$$;

revoke all on function public.process_telegram_update() from public, anon, authenticated;
grant execute on function public.process_telegram_update() to service_role;
revoke all on function public.bump_workspace_revision(), public.check_ticket_collaborator_org(), public.remove_ticket_collaborator()
  from public, anon, authenticated;
notify pgrst, 'reload schema';
commit;
