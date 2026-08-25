-- Phase 06 - Business Settings + Theme
-- File isolation between businesses.
--
-- SPEC: docs/specs/phase-06-business-settings-theme.md sections 8, 10, 11.
-- CLOVERCODE_MASTER.md section 32.

-- ---------------------------------------------------------------------------
-- Bucket
-- ---------------------------------------------------------------------------

-- Private. A public bucket would serve any object to anyone holding the URL,
-- which turns "isolation" into "nobody guessed the path yet". Reads go through
-- a signed URL minted only after the policies below have allowed the read.
--
-- One bucket for the whole platform, partitioned by the first path segments.
-- A bucket per tenant would mean an API call at provisioning time that can fail
-- separately from the transaction that creates the tenant.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'tenant-assets',
  'tenant-assets',
  false,
  -- 5 MB at the bucket, tighter per-folder limits in the application. Two
  -- layers: the bucket is the ceiling nobody can raise from the app.
  5242880,
  -- The union of what the folders actually accept, and nothing more. A type
  -- allowed here but rejected by every folder is a raised ceiling for no
  -- capability - and `image/svg+xml` in particular was excluded from branding
  -- on purpose, since an SVG can carry script. Leaving it here would have
  -- contradicted that reasoning at the layer that matters most.
  array['image/png', 'image/jpeg', 'image/webp', 'image/x-icon', 'application/pdf']
)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Path convention
-- ---------------------------------------------------------------------------

-- tenants/{tenant_id}/{folder}/{file}
--
-- The tenant is the SECOND segment. `storage.foldername(name)` returns the path
-- segments as an array, so the policies below read the tenant straight out of
-- the object's own name and compare it against the caller's permissions.
--
-- This is what makes the isolation real: it does not depend on the application
-- building the path correctly. Even if the app built a wrong path, the policy
-- would evaluate THAT path and refuse it.

-- Extracts the tenant id from an object path, or null when the path does not
-- follow the convention.
create or replace function public.storage_path_tenant_id(p_name text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_parts text[] := storage.foldername(p_name);
  v_part  text;
begin
  -- Must be tenants/{uuid}/... with at least a folder after the id.
  if array_length(v_parts, 1) is null or array_length(v_parts, 1) < 3 then
    return null;
  end if;
  if v_parts[1] <> 'tenants' then
    return null;
  end if;

  -- Reject a traversal or an empty segment ANYWHERE in the path.
  --
  -- Without this, `tenants/{A}/../{B}/branding/logo.png` passes: the second
  -- segment is still A, so the policy authorises it against A while the key
  -- reads as if it belonged to B. Supabase stores the key literally, so it does
  -- not cross over today - but any component that normalises the path later (a
  -- CDN, an S3-compatible backend, a migration script) would make it cross.
  -- Refusing the shape is cheaper than reasoning about every consumer.
  foreach v_part in array v_parts loop
    if v_part in ('', '.', '..') then
      return null;
    end if;
  end loop;

  begin
    return v_parts[2]::uuid;
  exception
    when invalid_text_representation then
      return null;
  end;
end;
$$;

comment on function public.storage_path_tenant_id(text) is
  'Tenant id encoded in a storage object path, or null if the path is not ours.';

revoke execute on function public.storage_path_tenant_id(text) from public;
grant execute on function public.storage_path_tenant_id(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Policies on storage.objects
-- ---------------------------------------------------------------------------

-- Read: belonging to the business is enough. A cashier has to see the logo.
create policy tenant_assets_select_member
  on storage.objects for select to authenticated
  using (
    bucket_id = 'tenant-assets'
    and public.storage_path_tenant_id(name) is not null
    and public.is_tenant_member(public.storage_path_tenant_id(name))
  );

-- Write: settings.manage, in the tenant the PATH names. A caller may ask for
-- any path; only the ones inside their own business pass.
create policy tenant_assets_insert_manager
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'tenant-assets'
    and public.storage_path_tenant_id(name) is not null
    and public.has_permission(public.storage_path_tenant_id(name), 'settings.manage')
  );

create policy tenant_assets_update_manager
  on storage.objects for update to authenticated
  using (
    bucket_id = 'tenant-assets'
    and public.storage_path_tenant_id(name) is not null
    and public.has_permission(public.storage_path_tenant_id(name), 'settings.manage')
  )
  with check (
    bucket_id = 'tenant-assets'
    and public.storage_path_tenant_id(name) is not null
    and public.has_permission(public.storage_path_tenant_id(name), 'settings.manage')
  );

create policy tenant_assets_delete_manager
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'tenant-assets'
    and public.storage_path_tenant_id(name) is not null
    and public.has_permission(public.storage_path_tenant_id(name), 'settings.manage')
  );
