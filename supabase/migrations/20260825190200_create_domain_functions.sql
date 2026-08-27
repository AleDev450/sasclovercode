-- Phase 09 - Custom Domains
-- Every write a business may perform on its own domains.
--
-- SPEC: docs/specs/phase-09-custom-domains.md sections 8, 11, 14.
--
-- Three functions and no UPDATE policy, which is the shape of the whole phase.
--
-- A domain is global identity: master section 27 says a domain belongs to
-- exactly one tenant. A mistake here does not leak rows, it hands one
-- business's TRAFFIC to another. So instead of writing a policy careful enough
-- to allow some column updates and not others - which PostgreSQL RLS cannot
-- express, since it is row-level and not column-level - a tenant gets no UPDATE
-- path at all, and each legitimate change is a function that decides for
-- itself what it is willing to write.
--
-- The transition that matters is the one that is ABSENT below: nothing here
-- writes `active`. `resolve_tenant_by_domain` serves only `active` domains, so
-- making that state unreachable from a tenant session is what stops a business
-- from pointing somebody else's name at its own site.

-- ---------------------------------------------------------------------------
-- claim_domain
-- ---------------------------------------------------------------------------

create or replace function public.claim_domain(p_tenant_id uuid, p_domain text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_domain   text;
  v_existing public.tenant_domains%rowtype;
  v_id       uuid;
begin
  if not public.has_permission(p_tenant_id, 'domains.manage') then
    raise exception 'Not allowed to manage domains for this tenant.'
      using errcode = '42501';
  end if;

  -- Normalised here as well as in the application. The application does it so
  -- the operator sees a decent message; this does it because a function that
  -- trusts its caller to have normalised is a function that will one day be
  -- called by something that did not.
  v_domain := lower(btrim(coalesce(p_domain, '')));
  v_domain := regexp_replace(v_domain, '^https?://', '');
  v_domain := split_part(v_domain, '/', 1);
  v_domain := rtrim(v_domain, '.');

  if v_domain !~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'
     or char_length(v_domain) not between 4 and 253 then
    raise exception 'That is not a valid domain name.' using errcode = '22023';
  end if;

  -- The platform's own namespace is not claimable.
  --
  -- Without this a tenant could claim `otro-negocio.clovercodeapp.com` before
  -- that business exists, and the system subdomain of a future tenant would be
  -- taken. The provisioning fix in 20260825190400 closes the other half of
  -- that hole; this closes the half that can be reached from a session.
  if v_domain = 'clovercodeapp.com' or v_domain like '%.clovercodeapp.com' then
    raise exception 'That domain belongs to the platform.' using errcode = '22023';
  end if;

  select * into v_existing
  from public.tenant_domains as d
  where d.domain = v_domain;

  if found then
    -- Already ours: idempotent. A business that clicks twice, or retries after
    -- a timeout, gets the same row rather than an error about its own domain.
    if v_existing.tenant_id = p_tenant_id then
      return v_existing.id;
    end if;

    -- Somebody else's, and unverified for long enough to be abandoned.
    --
    -- Without this rule the first claim wins forever: anyone could type
    -- `mcdonalds.pe`, never verify it, and the real owner could never connect
    -- their own name. A claim is a reservation, and a reservation nobody
    -- completes has to expire.
    --
    -- Seven days is long enough for a business to get DNS changed by whoever
    -- manages it, and short enough that squatting is not a strategy.
    if v_existing.verification_status in ('pending', 'failed')
       and v_existing.created_at < now() - interval '7 days' then
      delete from public.tenant_domains where id = v_existing.id;
    else
      -- Deliberately says nothing about who holds it.
      --
      -- "Already taken by Polleria El Rey" would turn this endpoint into a way
      -- to ask which of your competitors uses CloverCode. Same reasoning as
      -- 404-never-403 elsewhere in the system: the caller learns that they
      -- cannot have it, and nothing else.
      raise exception 'That domain is not available.' using errcode = '23505';
    end if;
  end if;

  insert into public.tenant_domains (
    tenant_id, domain, type, is_primary, verification_status, verification_token
  )
  values (
    p_tenant_id,
    v_domain,
    'custom',
    -- Never primary on arrival: a domain that serves no traffic must not
    -- become the canonical URL of the site (Phase 08 reads the primary).
    false,
    'pending',
    public.new_domain_verification_token()
  )
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.claim_domain(uuid, text) is
  'Reserves a domain for a tenant. Rejects the platform namespace, refuses a '
  'live domain of another tenant without saying whose, and releases an '
  'unverified claim older than seven days.';

revoke execute on function public.claim_domain(uuid, text) from public;
grant execute on function public.claim_domain(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- record_domain_ownership_check
-- ---------------------------------------------------------------------------

-- Records the result of a DNS lookup the SERVER performed.
--
-- The obvious hole is that the caller supplies the result: a tenant could call
-- this with p_ok = true without touching DNS at all. That is why the best
-- outcome it can produce is `verifying`.
--
-- `verifying` serves no traffic - `resolve_tenant_by_domain` matches only
-- `active` - and it puts the domain in front of an operator who registers it
-- with the hosting provider and does their own check. So a forged pass buys
-- nothing except a place in a queue where a human is looking.
--
-- The alternative was a trusted writer holding `service_role`, which ADR-011
-- deliberately declined to introduce until a phase demonstrated a need the
-- database could not meet. This is not that need: the state machine meets it.
create or replace function public.record_domain_ownership_check(
  p_domain_id uuid,
  p_ok        boolean,
  p_error     text default null
)
returns public.domain_verification_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.tenant_domains%rowtype;
begin
  select * into v_row from public.tenant_domains as d where d.id = p_domain_id;

  -- No row, or a row of a tenant the caller does not manage, produce the same
  -- answer. Distinguishing them would confirm that a domain id exists.
  if not found or not public.has_permission(v_row.tenant_id, 'domains.manage') then
    raise exception 'Domain not found.' using errcode = 'P0002';
  end if;

  if v_row.type = 'system' then
    raise exception 'A system domain has nothing to verify.' using errcode = '22023';
  end if;

  -- A live domain is not demoted by a tenant-side check. DNS can fail
  -- transiently, and taking a working site off the air because one lookup
  -- timed out would be a self-inflicted outage. Retiring a live domain is an
  -- operator decision.
  if v_row.verification_status = 'active' then
    return v_row.verification_status;
  end if;

  if p_ok then
    update public.tenant_domains
    set verification_status  = 'verifying',
        verification_checked_at = now(),
        last_error           = null
    where id = p_domain_id;
    return 'verifying'::public.domain_verification_status;
  end if;

  update public.tenant_domains
  set verification_status  = 'failed',
      verification_checked_at = now(),
      last_error           = left(coalesce(p_error, 'No se pudo comprobar el DNS.'), 300)
  where id = p_domain_id;
  return 'failed'::public.domain_verification_status;
end;
$$;

comment on function public.record_domain_ownership_check(uuid, boolean, text) is
  'Records a DNS ownership check. Can reach `verifying` or `failed` and never '
  '`active`: publishing a domain is an operator decision.';

revoke execute on function public.record_domain_ownership_check(uuid, boolean, text)
  from public;
grant execute on function public.record_domain_ownership_check(uuid, boolean, text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- set_primary_domain
-- ---------------------------------------------------------------------------

-- Two statements rather than one, because of the partial unique index that
-- allows a single primary per tenant: setting the new one first would collide
-- with the old one. Inside one function they are one transaction, so there is
-- no instant where a tenant has two primaries or none.
create or replace function public.set_primary_domain(p_domain_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.tenant_domains%rowtype;
begin
  select * into v_row from public.tenant_domains as d where d.id = p_domain_id;

  if not found or not public.has_permission(v_row.tenant_id, 'domains.manage') then
    raise exception 'Domain not found.' using errcode = 'P0002';
  end if;

  -- Only a domain that actually serves. Phase 08 builds the canonical URL from
  -- the primary domain, so a primary that does not resolve would point every
  -- search engine at an address that answers nothing.
  if v_row.verification_status <> 'active' then
    raise exception 'Only a verified domain can be the primary one.'
      using errcode = '22023';
  end if;

  update public.tenant_domains
  set is_primary = false
  where tenant_id = v_row.tenant_id and is_primary and id <> p_domain_id;

  update public.tenant_domains
  set is_primary = true
  where id = p_domain_id;
end;
$$;

comment on function public.set_primary_domain(uuid) is
  'Moves the primary flag within one tenant, atomically. Verified domains only.';

revoke execute on function public.set_primary_domain(uuid) from public;
grant execute on function public.set_primary_domain(uuid) to authenticated;
