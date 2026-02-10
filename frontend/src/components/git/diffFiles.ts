export interface DiffFile {
  path: string;
  additions: number;
  deletions: number;
}

/** Parse diff --git output into per-file summaries and +/- counts. */
export function parseDiffFiles(diff: string): DiffFile[] {
  const files: DiffFile[] = [];
  const chunks = diff.split(/^diff --git /m);

  for (const chunk of chunks) {
    if (!chunk.trim()) continue;

    const headerMatch = chunk.match(/^a\/(.+?) b\/(.+)/);
    if (!headerMatch) continue;

    const path = headerMatch[2];
    let additions = 0;
    let deletions = 0;

    for (const line of chunk.split('\n')) {
      if (line.startsWith('+') && !line.startsWith('+++')) additions++;
      if (line.startsWith('-') && !line.startsWith('---')) deletions++;
    }

    files.push({ path, additions, deletions });
  }

  return files;
}
