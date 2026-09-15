-- Storage writes, authorised per FOLDER instead of per bucket.
--
-- THE DEFECT THIS CLOSES. Phase 06 created `tenant-assets` when branding was
-- the only thing anybody uploaded, so all four write policies asked for
-- `settings.manage`. Two phases later the bucket also holds product photos
-- (`tenants/{id}/products/`) and page images (`tenants/{id}/banners/`), and the
-- people whose job those are cannot hold `settings.manage`:
--
--   * `manager` holds `products.update` and maintains the menu. It could not
--     upload a photo of a dish.
--   * an editor holds `content.manage` and maintains the website. It could not
--     upload an image for a page section.
--
-- The visible symptom was worse than a refusal: because there was no upload UI
-- at all, both screens asked the person to TYPE a storage path by hand. This
-- migration is what lets that UI exist for somebody other than the owner.
--
-- THE TENANT IS STILL READ OUT OF THE PATH, exactly as before. Nothing here
-- relaxes the isolation - `storage_path_tenant_id` is unchanged and every
-- policy below still calls it. What changes is only WHICH permission is
-- demanded once the tenant is known.

-- ---------------------------------------------------------------------------
-- The folder segment
-- ---------------------------------------------------------------------------

-- tenants/{tenant_id}/{folder}/{file} -> the third segment.
--
-- Returns null for anything that is not our shape, and `storage_path_tenant_id`
-- has already rejected traversal segments for the same path, so a caller cannot
-- name `branding` while writing somewhere else.
create or replace function public.storage_path_folder(p_name text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_parts text[] := storage.foldername(p_name);
begin
  if array_length(v_parts, 1) is null or array_length(v_parts, 1) < 3 then
    return null;
  end if;
  if v_parts[1] <> 'tenants' then
    return null;
  end if;
  if v_parts[3] not in ('branding', 'products', 'banners', 'documents') then
    return null;
  end if;

  return v_parts[3];
end;
$$;

comment on function public.storage_path_folder(text) is
  'Asset folder encoded in a storage object path, or null if the path is not ours.';

revoke execute on function public.storage_path_folder(text) from public;
grant execute on function public.storage_path_folder(text) to authenticated;

-- ---------------------------------------------------------------------------
-- The permission a folder demands
-- ---------------------------------------------------------------------------

-- Mirrored in `src/lib/storage/assets.ts` as ASSET_FOLDER_PERMISSION. That copy
-- is what turns a refusal into a readable field error before the upload is
-- attempted; THIS is what makes it true.
--
-- `settings.manage` is accepted for every folder on top of the specific one: an
-- owner configuring their shop should not be refused a product photo because
-- the narrower permission happens to sit on a different role. It widens who may
-- write, never which tenant they may write to.
create or replace function public.can_write_tenant_asset(p_name text)
returns boolean
language plpgsql
stable
set search_path = ''
as $$
declare
  v_tenant uuid := public.storage_path_tenant_id(p_name);
  v_folder text := public.storage_path_folder(p_name);
begin
  if v_tenant is null or v_folder is null then
    return false;
  end if;

  if public.has_permission(v_tenant, 'settings.manage') then
    return true;
  end if;

  return case v_folder
    when 'products' then public.has_permission(v_tenant, 'products.update')
    when 'banners'  then public.has_permission(v_tenant, 'content.manage')
    else false
  end;
end;
$$;

comment on function public.can_write_tenant_asset(text) is
  'True when the caller may write this object, judged by the tenant AND folder in its path.';

revoke execute on function public.can_write_tenant_asset(text) from public;
grant execute on function public.can_write_tenant_asset(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Policies
-- ---------------------------------------------------------------------------

-- Reads are unchanged: belonging to the business is enough, because a cashier
-- has to see the logo. Only the three write policies are replaced.
drop policy if exists tenant_assets_insert_manager on storage.objects;
drop policy if exists tenant_assets_update_manager on storage.objects;
drop policy if exists tenant_assets_delete_manager on storage.objects;

create policy tenant_assets_insert_writer
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'tenant-assets'
    and public.can_write_tenant_asset(name)
  );

create policy tenant_assets_update_writer
  on storage.objects for update to authenticated
  using (
    bucket_id = 'tenant-assets'
    and public.can_write_tenant_asset(name)
  )
  with check (
    bucket_id = 'tenant-assets'
    and public.can_write_tenant_asset(name)
  );

create policy tenant_assets_delete_writer
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'tenant-assets'
    and public.can_write_tenant_asset(name)
  );
