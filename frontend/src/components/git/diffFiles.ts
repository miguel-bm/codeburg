export interface DiffFile {
  path: string;
  additions: number;
  deletions: number;
}

/** Split a git patch into one patch payload per `diff --git` file block. */
export function splitDiffIntoFilePatches(diff: string): string[] {
  const trimmed = diff.trim();
  if (!trimmed) return [];

  const chunks = trimmed
    .split(/(?=^diff --git )/m)
    .map((chunk) => chunk.trim())
    .filter(Boolean);

  // Some git outputs (or errors) may not include a `diff --git` header.
  return chunks.length > 0 ? chunks : [trimmed];
}

/** Parse diff --git output into per-file summaries and +/- counts. */
export function parseDiffFiles(diff: string): DiffFile[] {
  const files: DiffFile[] = [];
  const chunks = splitDiffIntoFilePatches(diff);

  for (const chunk of chunks) {
    const headerMatch = chunk.match(/^diff --git a\/(.+?) b\/(.+)$/m);
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
