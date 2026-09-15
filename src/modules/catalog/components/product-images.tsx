import { Badge, Button, EmptyState } from "@/components/ui";
import { IconCheck, IconImage } from "@/components/ui/icons";
import { signAssetPaths } from "@/lib/storage/sign";
import { setPrimaryImageAction } from "../server/actions";
import { DeleteChildForm } from "./catalog-forms";

export interface ProductImage {
  readonly id: string;
  readonly path: string;
  readonly altText: string | null;
  readonly isPrimary: boolean;
}

/**
 * The photos of a product, as photos.
 *
 * WHAT IT REPLACED. A list of storage paths in a monospace font - the literal
 * string `tenants/6f2e.../products/foto.jpg` - next to a delete button. It was
 * impossible to tell which photo was which without deleting one to find out,
 * and a product whose image failed to upload looked identical to one whose
 * image was fine.
 *
 * A Server Component because signing is asynchronous and the bucket is private:
 * every path is signed in ONE round trip here and the grid renders what came
 * back. A path that fails to sign renders as a placeholder tile rather than a
 * broken image, and it still gets its delete button - which is the only way to
 * be rid of a file whose object went missing.
 */
export async function ProductImageGrid({
  tenantSlug,
  productId,
  images,
  canManage,
}: {
  tenantSlug: string;
  productId: string;
  images: readonly ProductImage[];
  canManage: boolean;
}) {
  if (images.length === 0) {
    return (
      <EmptyState
        title="Sin fotos todavia"
        description="Una foto es lo primero que mira un cliente en la carta. Sube una abajo."
        icon={<IconImage className="size-8" />}
      />
    );
  }

  const urls = await signAssetPaths(images.map((image) => image.path));

  return (
    <ul className="grid gap-4 sm:grid-cols-3 lg:grid-cols-4">
      {images.map((image) => {
        const url = urls.get(image.path);

        return (
          <li key={image.id} className="flex flex-col gap-2">
            <div className="border-border bg-muted relative aspect-square overflow-hidden rounded-lg border">
              {url !== undefined ? (
                /* eslint-disable-next-line @next/next/no-img-element -- a signed
                   Storage URL, whose host is not known at build time. */
                <img
                  src={url}
                  alt={image.altText ?? ""}
                  className="size-full bg-white object-cover"
                />
              ) : (
                <div className="text-muted-foreground flex size-full flex-col items-center justify-center gap-2 text-center text-xs">
                  <IconImage className="size-6" />
                  No se pudo cargar
                </div>
              )}

              {image.isPrimary ? (
                <Badge variant="success" className="absolute top-2 left-2">
                  <IconCheck className="size-3" />
                  Principal
                </Badge>
              ) : null}
            </div>

            {image.altText !== null && image.altText.length > 0 ? (
              <p className="text-muted-foreground line-clamp-2 text-xs">{image.altText}</p>
            ) : (
              <p className="text-warning text-xs">Sin texto alternativo</p>
            )}

            {canManage ? (
              <div className="flex flex-wrap items-center gap-2">
                {!image.isPrimary ? (
                  <form action={setPrimaryImageAction}>
                    <input type="hidden" name="tenantSlug" value={tenantSlug} />
                    <input type="hidden" name="productId" value={productId} />
                    <input type="hidden" name="imageId" value={image.id} />
                    <Button type="submit" variant="outline" size="sm">
                      Hacer principal
                    </Button>
                  </form>
                ) : null}
                <DeleteChildForm
                  tenantSlug={tenantSlug}
                  productId={productId}
                  childId={image.id}
                  kind="image"
                />
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
