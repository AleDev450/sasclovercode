-- Phase 19 - Delivery
-- Coordinates on the customer's address book.
--
-- SPEC: docs/specs/phase-19-delivery.md sections 8, 20.
-- CLOVERCODE_MASTER.md section 33 (Phase 19): "coordenadas".
--
-- Master lists "coordenadas" among the six capabilities of this phase.
-- `order_deliveries` snapshots them, like every other part of the address - but
-- a snapshot needs a source, and without this the field could only ever be
-- typed by hand, once per delivery, for the same house every time.
--
-- `locations` (Phase 10) already carries exactly this pair with exactly these
-- constraints. Same types, same rules, same reasoning - a coordinate is a
-- coordinate wherever it sits.
--
-- Non-destructive: two nullable columns and two CHECKs that every existing row
-- satisfies (both NULL). No data migration, no backfill, no default.

alter table public.customer_addresses
  add column latitude  numeric(9, 6),
  add column longitude numeric(9, 6);

comment on column public.customer_addresses.latitude is
  'Optional. Copied onto order_deliveries when a delivery uses this address.';

-- Half a coordinate is not a location, it is a bug that will render a pin in
-- the Atlantic. Both or neither - the same constraint, word for word, that
-- `locations` has carried since Phase 10.
alter table public.customer_addresses
  add constraint customer_addresses_coordinates_together
    check ((latitude is null) = (longitude is null));

alter table public.customer_addresses
  add constraint customer_addresses_latitude_range
    check (latitude is null or latitude between -90 and 90);

alter table public.customer_addresses
  add constraint customer_addresses_longitude_range
    check (longitude is null or longitude between -180 and 180);
