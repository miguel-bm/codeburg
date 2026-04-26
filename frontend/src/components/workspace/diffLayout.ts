const TIGHT_DIFF_WIDTH_PX = 1000;

export type DiffLayoutMode = 'split' | 'unified';

export function getDiffLayoutMode(opts: {
  isMobile: boolean;
  containerWidth: number;
  original: string;
  modified: string;
}): DiffLayoutMode {
  const { isMobile, containerWidth, original, modified } = opts;
  const isEntirelyNewFile = original.length === 0 && modified.length > 0;
  const isTightWidth = containerWidth > 0 && containerWidth < TIGHT_DIFF_WIDTH_PX;
  if (isMobile || isTightWidth || isEntirelyNewFile) return 'unified';
  return 'split';
}
