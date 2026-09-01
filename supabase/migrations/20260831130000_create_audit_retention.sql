-- Phase 27 - Backups + Disaster Recovery
-- How long the audit trail is kept, and who may shorten it.
--
-- SPEC: docs/specs/phase-27-backups-dr.md sections 8, 11.
-- Closes KL-2402, which Phase 24 left to this phase.
--
-- `audit_logs` grows forever by design: every write to every governed table
-- appends a row, and nothing ever updates or deletes one. That is correct for
-- an audit trail and unsustainable as a storage plan, so a retention policy is
-- part of recovery rather than of housekeeping - a table nobody can back up in
-- a reasonable window is a table that stops being recoverable.

create or replace function public.purge_audit_logs(
  p_older_than interval default interval '365 days'
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_minimum constant interval := interval '90 days';
  v_deleted bigint;
begin
  /*
   * A floor, and the reason it exists.
   *
   * Without it, `purge_audit_logs(interval '1 hour')` empties the audit trail
   * with one parameter - and the person most likely to type that is the person
   * who least wants the trail to exist. Master section 17 asks for auditing
   * precisely for that moment.
   *
   * Ninety days is the shortest window in which a dispute about a document, a
   * price change or a permission grant is still likely to be raised.
   */
  if p_older_than < v_minimum then
    raise exception 'Audit retention cannot be shorter than 90 days.'
      using errcode = '22023';
  end if;

  delete from public.audit_logs
  where created_at < now() - p_older_than;

  get diagnostics v_deleted = row_count;

  -- Logged in the trail's own terms: how many, and from when. Not which rows,
  -- because the point of deleting them is that they are gone.
  raise notice 'audit.purged deleted=% older_than=%', v_deleted, p_older_than;

  return v_deleted;
end;
$$;

comment on function public.purge_audit_logs(interval) is
  'Deletes audit rows older than the interval. Refuses anything under 90 days: '
  'an audit trail that can be emptied on request is not an audit trail.';

-- No grant to `anon` or `authenticated`.
--
-- PostgreSQL grants EXECUTE to PUBLIC by default, which on a SECURITY DEFINER
-- function means every present and future role inherits it without anyone
-- deciding so. Revoked, and deliberately not granted back: this is run by an
-- operator or a scheduled job, never from a session belonging to a business
-- whose own actions are what the table records.
revoke execute on function public.purge_audit_logs(interval) from public;
