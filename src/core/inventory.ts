import { CANDY_KINDS, type Inventory } from '../types';

export function emptyInventory(): Inventory {
  return { frankenstein: 0, witch: 0, spider: 0, pumpkin: 0, candyCorn: 0, sucker: 0 };
}

export function cloneInventory(inv: Inventory): Inventory {
  return { ...inv };
}

export function addInventories(a: Inventory, b: Inventory): Inventory {
  const out = emptyInventory();
  for (const k of CANDY_KINDS) out[k] = a[k] + b[k];
  return out;
}

export function inventoryTotal(inv: Inventory): number {
  let n = 0;
  for (const k of CANDY_KINDS) n += inv[k];
  return n;
}
