"use client";

/**
 * The upload control.
 *
 * WHAT IT REPLACES. Until this existed, putting a photo on a product meant
 * reading a hint that said "subela en Configuracion y pega aqui su ruta:
 * tenants/.../products/foto.jpg" - and Configuracion had no uploader either, so
 * the instruction pointed at a screen that could not do the thing. The logo and
 * the favicon were worse: `uploadBrandingAssetAction` had existed since Phase
 * 06 and no component in the repository called it. A business could not put its
 * own logo on its own website.
 *
 * WHAT IT DOES. Drop a file on it, or click it, or pick one this business
 * already uploaded. The file goes up immediately, the thumbnail appears, and
 * the stored PATH lands in a hidden input for whatever form surrounds it. The
 * surrounding form is not submitted by any of that - it still submits when the
 * person presses its own button, which is the only moment anything is saved.
 *
 * THE PATH IS THE VALUE, NOT THE URL. Every URL here is signed and expires in
 * an hour. Storing one in a row would mean a product whose photo works for an
 * afternoon, which is the mistake the schema comment in `product_images` warns
 * about; the row keeps the path and the renderer signs it again.
 */

import { useCallback, useEffect, useId, useRef, useState, useTransition } from "react";
import { Button, Label, Spinner } from "@/components/ui";
import { IconImage, IconGrid, IconTrash, IconUpload } from "@/components/ui/icons";
import {
  acceptAttribute,
  acceptedExtensions,
  formatBytes,
  maxMegabytes,
  type AssetFolder,
} from "@/lib/storage/asset-folders";
import { cn } from "@/lib/utils";
import {
  listTenantAssetsAction,
  resolveTenantAssetsAction,
  uploadTenantAssetAction,
} from "../server/actions";
import type { StoredAsset } from "../types";

/** How the preview box is shaped. A logo is not a dish photo. */
const ASPECT: Record<string, string> = {
  square: "aspect-square",
  wide: "aspect-[4/3]",
  banner: "aspect-[16/6]",
  logo: "aspect-[5/2]",
};

export interface AssetPickerProps {
  tenantSlug: string;
  folder: AssetFolder;
  /** Shown above the control. Always required: a field with no label is a bug. */
  label: string;
  /**
   * Name of the hidden input carrying the path.
   *
   * Omit it in a controlled parent (the section editor builds JSON from state
   * and submits that instead), and pass `onChange` there.
   */
  name?: string;
  /** The path already stored, if any. Uncontrolled: the control owns it. */
  defaultValue?: string | null;
  /**
   * Controlled value, for a parent that keeps the list.
   *
   * A gallery is the reason this exists. Its entries are keyed by index, so
   * removing the second of three photos shifts the third into slot two - and a
   * control holding its own copy of the path would go on showing the photo that
   * used to live there. Passing the value down makes the parent the single
   * source of truth for which file each slot holds.
   */
  value?: string | null;
  /** A signed URL for `defaultValue`, when the server already had one. */
  defaultPreviewUrl?: string | null;
  onChange?: (path: string | null) => void;
  /**
   * Fixed file name, without extension.
   *
   * Set it for a slot that has exactly one occupant (`logo`, `favicon`): the
   * upload then REPLACES. Leave it out for a collection, where each upload is
   * a new file and overwriting the last one would be data loss.
   */
  basename?: string;
  aspect?: keyof typeof ASPECT;
  hint?: string;
  /** False renders the current image with no way to change it. */
  canEdit?: boolean;
  className?: string;
}

export function AssetPicker({
  tenantSlug,
  folder,
  label,
  name,
  defaultValue = null,
  defaultPreviewUrl = null,
  value,
  onChange,
  basename,
  aspect = "wide",
  hint,
  canEdit = true,
  className,
}: AssetPickerProps) {
  const inputId = useId();
  const statusId = useId();
  const fileRef = useRef<HTMLInputElement>(null);

  /*
   * The pair is one piece of state, not two.
   *
   * A URL belongs to the path it was signed for. Keeping them apart let the
   * preview outlive the value it described, which is exactly the gallery bug
   * above: the path moved on and the thumbnail did not.
   */
  const [own, setOwn] = useState<{ path: string | null; url: string | null }>({
    path: defaultValue,
    url: defaultPreviewUrl,
  });

  const path = value !== undefined ? value : own.path;
  // A URL from a different path is not this slot's URL, so it is discarded and
  // the effect below signs the right one.
  const url = own.path === path ? own.url : null;

  const [error, setError] = useState<string | null>(null);
  const [isDragging, setDragging] = useState(false);
  const [isBusy, startUpload] = useTransition();

  const [libraryOpen, setLibraryOpen] = useState(false);
  const [library, setLibrary] = useState<readonly StoredAsset[] | null>(null);
  const [isLoadingLibrary, startLibrary] = useTransition();

  const commit = useCallback(
    (next: string | null, nextUrl: string | null) => {
      setOwn({ path: next, url: nextUrl });
      onChange?.(next);
    },
    [onChange],
  );

  /*
   * A stored path with no URL yet.
   *
   * Happens when a server component renders an existing row without signing it
   * first. Resolving here rather than demanding the URL as a prop keeps every
   * call site from having to know that the bucket is private.
   */
  useEffect(() => {
    if (path === null || url !== null) return;

    let cancelled = false;
    const body = new FormData();
    body.set("tenantSlug", tenantSlug);
    body.set("folder", folder);
    body.set("paths", JSON.stringify([path]));

    void resolveTenantAssetsAction(body).then((result) => {
      if (cancelled || !result.ok) return;
      const resolved = result.urls[path];
      if (resolved !== undefined) setOwn({ path, url: resolved });
    });

    return () => {
      cancelled = true;
    };
  }, [path, url, tenantSlug, folder]);

  function upload(file: File) {
    setError(null);

    const body = new FormData();
    body.set("tenantSlug", tenantSlug);
    body.set("folder", folder);
    body.set("file", file);
    if (basename !== undefined) body.set("basename", basename);

    startUpload(async () => {
      const result = await uploadTenantAssetAction(body);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      /*
       * A replaced file keeps its path, so the browser would show the cached
       * old image under the same signed URL. The token differs on every sign,
       * which is enough to bust it - but only because we take the URL the
       * server just returned instead of keeping the one we had.
       */
      commit(result.asset.path, result.asset.url);
      // The library is now stale. Drop it rather than refetching: it is only
      // fetched when somebody opens the panel.
      setLibrary(null);
    });
  }

  function openLibrary() {
    setLibraryOpen(true);
    if (library !== null) return;

    const body = new FormData();
    body.set("tenantSlug", tenantSlug);
    body.set("folder", folder);

    startLibrary(async () => {
      const result = await listTenantAssetsAction(body);
      if (result.ok) setLibrary(result.assets);
      else setError(result.error);
    });
  }

  const busy = isBusy;

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor={inputId}>{label}</Label>
        {canEdit && path !== null ? (
          <button
            type="button"
            onClick={() => commit(null, null)}
            className="text-muted-foreground hover:text-destructive inline-flex items-center gap-1 text-xs transition-colors"
          >
            <IconTrash className="size-3.5" />
            Quitar
          </button>
        ) : null}
      </div>

      {/* The value the surrounding form submits. */}
      {name !== undefined ? <input type="hidden" name={name} value={path ?? ""} /> : null}

      {/*
        A label element and not a div: clicking it opens the file dialog with
        no JavaScript of ours, and the real file input inside stays in the tab
        order, so the control is reachable by keyboard for free.
      */}
      <label
        htmlFor={inputId}
        onDragOver={(event) => {
          if (!canEdit) return;
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          if (!canEdit) return;
          event.preventDefault();
          setDragging(false);
          const file = event.dataTransfer.files[0];
          if (file !== undefined) upload(file);
        }}
        className={cn(
          "border-input bg-background relative flex flex-col items-center justify-center gap-2 overflow-hidden rounded-xl border border-dashed p-4 text-center transition-colors",
          ASPECT[aspect],
          canEdit ? "hover:border-primary/50 hover:bg-accent/40 cursor-pointer" : "cursor-default",
          isDragging && "border-primary bg-accent",
          error !== null && "border-destructive",
        )}
      >
        {url !== null ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element -- a signed
                Storage URL, whose host is not known at build time, so
                next/image cannot be configured for it. */}
            <img
              src={url}
              alt=""
              className="absolute inset-0 size-full object-contain p-2"
              draggable={false}
            />
            {canEdit ? (
              <span className="bg-background/85 text-foreground shadow-e1 relative mt-auto rounded-full px-3 py-1 text-xs font-medium backdrop-blur-sm">
                Cambiar imagen
              </span>
            ) : null}
          </>
        ) : (
          <>
            <span
              className={cn(
                "flex size-10 items-center justify-center rounded-full transition-colors",
                isDragging
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground",
              )}
            >
              {busy ? <Spinner className="size-4" label="Subiendo" /> : <IconUpload />}
            </span>
            <span className="text-sm font-medium">
              {busy ? "Subiendo..." : "Arrastra una imagen o haz clic"}
            </span>
            <span className="text-muted-foreground text-xs">
              {acceptedExtensions(folder)} · hasta {maxMegabytes(folder)} MB
            </span>
          </>
        )}

        <input
          ref={fileRef}
          id={inputId}
          type="file"
          accept={acceptAttribute(folder)}
          disabled={!canEdit || busy}
          aria-describedby={statusId}
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file !== undefined) upload(file);
            // Let the same file be chosen twice in a row - after a failed
            // upload, picking it again must fire `change`.
            event.target.value = "";
          }}
        />
      </label>

      {/* ------------------------------------------------------- status line */}
      <p id={statusId} aria-live="polite" className="text-xs">
        {error !== null ? (
          <span className="text-destructive">{error}</span>
        ) : hint !== undefined ? (
          <span className="text-muted-foreground">{hint}</span>
        ) : null}
      </p>

      {canEdit ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => fileRef.current?.click()}
          >
            <IconUpload />
            Subir
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => (libraryOpen ? setLibraryOpen(false) : openLibrary())}
          >
            <IconGrid />
            {libraryOpen ? "Cerrar galeria" : "Mis imagenes"}
          </Button>
        </div>
      ) : null}

      {/* ----------------------------------------------------------- library */}
      {libraryOpen ? (
        <div className="border-border bg-muted/30 flex flex-col gap-3 rounded-xl border p-3">
          <p className="text-muted-foreground text-xs">
            Imagenes que ya subiste. Elige una para reutilizarla sin volver a subirla.
          </p>

          {isLoadingLibrary ? (
            <div className="flex items-center gap-2 py-6 text-sm">
              <Spinner className="size-4" label="Cargando" />
              Cargando tus imagenes...
            </div>
          ) : library === null || library.length === 0 ? (
            <div className="text-muted-foreground flex flex-col items-center gap-2 py-6 text-center text-sm">
              <IconImage className="size-6" />
              Todavia no hay imagenes en esta carpeta.
            </div>
          ) : (
            <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {library.map((asset) => {
                const selected = asset.path === path;
                return (
                  <li key={asset.path}>
                    <button
                      type="button"
                      onClick={() => {
                        commit(asset.path, asset.url);
                        setLibraryOpen(false);
                      }}
                      title={`${asset.name} · ${formatBytes(asset.bytes)}`}
                      className={cn(
                        "focus-visible:outline-ring block aspect-square w-full overflow-hidden rounded-lg border transition-[border-color,box-shadow] focus-visible:outline-2 focus-visible:outline-offset-2",
                        selected
                          ? "border-primary ring-primary/25 ring-2"
                          : "border-border hover:border-primary/50",
                      )}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element -- signed URL, see above */}
                      <img
                        src={asset.url}
                        alt={asset.name}
                        className="size-full bg-white object-cover"
                        loading="lazy"
                      />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
