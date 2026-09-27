export type NameProblem = '' | 'name' | 'number';
export const APPROVED_NAMES: ReadonlySet<string>;
export function nameProblem(name: string): NameProblem;
export function approvedName(name: string): string;
