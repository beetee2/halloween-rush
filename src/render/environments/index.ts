import { buildCarnival } from './carnival';
import type { Environment } from './common';
import { buildForest } from './forest';
import { buildGraveyard } from './graveyard';
import { buildHauntedHouse } from './hauntedHouse';
import { buildPumpkinPatch } from './pumpkinPatch';

export type { Environment, EnvironmentLayout, SpiderAnchor } from './common';

/** Level order: the first two were chosen by the player's family; the rest are defaults. */
export const ENVIRONMENTS: ReadonlyArray<{ name: string; build: () => Environment }> = [
  { name: 'Haunted House', build: buildHauntedHouse },
  { name: 'Graveyard', build: buildGraveyard },
  { name: 'Spooky Forest', build: buildForest },
  { name: 'Pumpkin Patch', build: buildPumpkinPatch },
  { name: 'Haunted Carnival', build: buildCarnival },
];

export function environmentName(index: number): string {
  return ENVIRONMENTS[((index % ENVIRONMENTS.length) + ENVIRONMENTS.length) % ENVIRONMENTS.length]!.name;
}
