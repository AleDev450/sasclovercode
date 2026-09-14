-- The price list becomes public.
--
-- `modules`, `plans` and `plan_modules` were opened to `authenticated` in Phase
-- 21, when the only screen that read them was inside the dashboard. The landing
-- page changes who needs them: a visitor comparing plans has no session, by
-- definition, and a pricing section is not a pricing section if it cannot be
-- read before signing up.
--
-- IS THIS SAFE. These three tables hold no tenant data and no personal data -
-- they are the product's price list, and the Phase 21 migration already said as
-- much in the comment beside the `using (true)` it granted: "as public as its
-- marketing page". This makes that literal.
--
-- Note what is NOT opened. `subscriptions` and `saas_payments` say what a
-- SPECIFIC business pays, which is a different fact with a different audience,
-- and their policies are untouched.
--
-- The existing `*_select_authenticated` policies are left in place rather than
-- widened. PostgreSQL ORs permissive policies together, so an anonymous reader
-- matches the new one and a signed-in reader still matches the old - and the
-- history stays legible: one policy per audience, each named after its
-- audience.

create policy modules_select_anon
  on public.modules for select to anon using (true);

create policy plans_select_anon
  on public.plans for select to anon using (true);

create policy plan_modules_select_anon
  on public.plan_modules for select to anon using (true);
