-- Phase 12 - Customers
-- Peruvian identity documents.
--
-- SPEC: docs/specs/phase-12-customers.md sections 8, 11.
-- CLOVERCODE_MASTER.md section 33 (Phase 12).
--
-- This file exists before `customers` because the table's CHECK constraint
-- calls the function below, and a CHECK may only call an IMMUTABLE function.

-- Exactly the three documents master section 33 names.
--
-- `pasaporte` is not here despite being common in a hotel or a restaurant that
-- serves tourists: it is not in the master document, and section 51 forbids
-- building ahead of the phase that needs something. Adding it later is
-- `alter type ... add value`, which does not rewrite the table.
create type public.customer_doc_type as enum ('dni', 'ruc', 'ce');

comment on type public.customer_doc_type is
  'DNI, RUC or carne de extranjeria. Master section 33 (Phase 12).';

-- ---------------------------------------------------------------------------
-- RUC check digit
-- ---------------------------------------------------------------------------

-- A RUC whose check digit does not add up is a RUC that DOES NOT EXIST.
--
-- Why this is in the database rather than only in Zod:
--
-- If a malformed RUC reaches the table, Phase 17 sends it to SUNAT, SUNAT
-- rejects the document, and the error appears five phases away from the form
-- that caused it - with an invoice in the middle. And the dashboard form is not
-- the only writer: a platform operator has policies, Phase 15 brings its own
-- POS, Phase 13 will create customers mid-order. An invariant that depends on
-- every writer remembering is not an invariant. Same argument Phase 10 used for
-- `guard_last_active_location`.
--
-- The algorithm is SUNAT's modulo 11:
--
--   weights 5,4,3,2,7,6,5,4,3,2 over the first ten digits
--   remainder = sum mod 11
--   expected  = 11 - remainder, with 10 -> 0 and 11 -> 1
--
-- IMMUTABLE is required by the CHECK that calls it, and honest: the same string
-- always produces the same answer, with no reads and no dependence on settings.
create or replace function public.is_valid_ruc(p_value text)
returns boolean
language plpgsql
immutable
-- No table is read, but an empty search_path is set anyway: a SECURITY INVOKER
-- function reached through a CHECK still resolves unqualified names, and the
-- project's rule (Phase 03) is that no function relies on the caller's path.
set search_path = ''
as $$
declare
  v_weights constant int[] := array[5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  v_sum     int := 0;
  v_i       int;
  v_check   int;
begin
  if p_value is null then
    return false;
  end if;

  -- Eleven digits, nothing else. `~` anchored at both ends: without the anchors
  -- '20131312955abc' would match.
  if p_value !~ '^[0-9]{11}$' then
    return false;
  end if;

  -- The first two digits say what kind of taxpayer this is. SUNAT issues
  -- 10 (natural person), 15, 16, 17 and 20 (legal entity); anything else is
  -- not a RUC even if the check digit happens to work out.
  if substring(p_value from 1 for 2) not in ('10', '15', '16', '17', '20') then
    return false;
  end if;

  for v_i in 1..10 loop
    v_sum := v_sum + (substring(p_value from v_i for 1))::int * v_weights[v_i];
  end loop;

  v_check := 11 - (v_sum % 11);

  if v_check = 10 then
    v_check := 0;
  elsif v_check = 11 then
    v_check := 1;
  end if;

  return v_check = (substring(p_value from 11 for 1))::int;
end;
$$;

comment on function public.is_valid_ruc(text) is
  'SUNAT modulo-11 check digit. IMMUTABLE so a CHECK constraint can call it.';

grant execute on function public.is_valid_ruc(text) to anon, authenticated, service_role;
