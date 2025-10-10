import type { Pair } from '../../sources/source-adapter.interface';

export function formatPairLabel(pair: Pair): string {
  return pair.join('/');
}

export function formatPairKey(pair: Pair): string {
  return pair.join('-');
}

export function parsePairLabel(pairLabel: string): Pair {
  return pairLabel.split('/') as Pair;
}

export function parsePairKey(pairKey: string): Pair {
  return pairKey.split('-') as Pair;
}
