"use client";

/**
 * The cart, shared by the header, the menu, the drawer and the checkout.
 *
 * WHY AN EXTERNAL STORE AND NOT `useState` + `useEffect`. The cart lives in
 * localStorage, which does not exist on the server. Reading it in an effect
 * means one render with an empty cart and a second with the real one - a
 * visible flicker of "0" on the header badge - and a write-back effect that can
 * race the read. `useSyncExternalStore` renders the empty server snapshot during
 * hydration and the stored cart immediately after, with no effect in between,
 * and the `storage` event keeps two open tabs in agreement for free.
 *
 * One store per tenant key, because a person can have two restaurants' sites
 * open at once and each must keep its own cart.
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  addLine,
  cartCount,
  cartSubtotal,
  parseStoredCart,
  removeLine,
  setLineQuantity,
  type CartLine,
  type NewCartLine,
} from "../cart";

interface CartStore {
  subscribe(listener: () => void): () => void;
  getSnapshot(): readonly CartLine[];
  write(next: readonly CartLine[]): void;
}

const EMPTY: readonly CartLine[] = [];
const stores = new Map<string, CartStore>();

function createStore(key: string): CartStore {
  let lines: readonly CartLine[] | null = null;
  const listeners = new Set<() => void>();

  const read = (): readonly CartLine[] => {
    if (lines === null) {
      try {
        lines = parseStoredCart(window.localStorage.getItem(key));
      } catch {
        // Private mode, blocked storage, a sandboxed iframe: an in-memory cart
        // still lets the visitor order from this page.
        lines = [];
      }
    }
    return lines;
  };

  return {
    subscribe(listener) {
      listeners.add(listener);
      const onStorage = (event: StorageEvent) => {
        if (event.key !== key) return;
        lines = null;
        listener();
      };
      window.addEventListener("storage", onStorage);
      return () => {
        listeners.delete(listener);
        window.removeEventListener("storage", onStorage);
      };
    },
    getSnapshot: read,
    write(next) {
      lines = next;
      try {
        window.localStorage.setItem(key, JSON.stringify(next));
      } catch {
        // Same as above: the cart keeps working, it just does not survive a reload.
      }
      for (const listener of listeners) listener();
    },
  };
}

function storeFor(key: string): CartStore {
  let store = stores.get(key);
  if (store === undefined) {
    store = createStore(key);
    stores.set(key, store);
  }
  return store;
}

export interface CartApi {
  readonly lines: readonly CartLine[];
  readonly count: number;
  /** The labels' sum. The checkout re-prices before showing a total. */
  readonly subtotal: number;
  readonly isOpen: boolean;
  add(line: NewCartLine): void;
  setQuantity(key: string, quantity: number): void;
  remove(key: string): void;
  clear(): void;
  open(): void;
  close(): void;
}

const CartContext = createContext<CartApi | null>(null);

export function CartProvider({ tenantId, children }: { tenantId: string; children: ReactNode }) {
  const store = storeFor(`clovercode:cart:${tenantId}`);
  const lines = useSyncExternalStore(store.subscribe, store.getSnapshot, () => EMPTY);
  const [isOpen, setOpen] = useState(false);

  const add = useCallback(
    (line: NewCartLine) => store.write(addLine(store.getSnapshot(), line)),
    [store],
  );
  const setQuantity = useCallback(
    (key: string, quantity: number) =>
      store.write(setLineQuantity(store.getSnapshot(), key, quantity)),
    [store],
  );
  const remove = useCallback(
    (key: string) => store.write(removeLine(store.getSnapshot(), key)),
    [store],
  );
  const clear = useCallback(() => store.write([]), [store]);
  const open = useCallback(() => setOpen(true), []);
  const close = useCallback(() => setOpen(false), []);

  const api = useMemo<CartApi>(
    () => ({
      lines,
      count: cartCount(lines),
      subtotal: cartSubtotal(lines),
      isOpen,
      add,
      setQuantity,
      remove,
      clear,
      open,
      close,
    }),
    [lines, isOpen, add, setQuantity, remove, clear, open, close],
  );

  return <CartContext.Provider value={api}>{children}</CartContext.Provider>;
}

export function useCart(): CartApi {
  const cart = useContext(CartContext);
  if (cart === null) throw new Error("useCart must be used inside <CartProvider>.");
  return cart;
}
