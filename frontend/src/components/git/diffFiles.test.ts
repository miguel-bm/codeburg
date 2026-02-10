import { describe, expect, it } from 'vitest';
import { parseDiffFiles, splitDiffIntoFilePatches } from './diffFiles';

const multiFilePatch = `diff --git a/alpha.txt b/alpha.txt
index 83db48f..f735c2f 100644
--- a/alpha.txt
+++ b/alpha.txt
@@ -1 +1,2 @@
 line
+extra
diff --git a/beta.txt b/beta.txt
index 85c3040..9c59e24 100644
--- a/beta.txt
+++ b/beta.txt
@@ -1,2 +1 @@
-old
 keep`;

describe('splitDiffIntoFilePatches', () => {
  it('splits a multi-file patch into one patch per file', () => {
    const patches = splitDiffIntoFilePatches(multiFilePatch);

    expect(patches).toHaveLength(2);
    expect(patches[0].startsWith('diff --git a/alpha.txt b/alpha.txt')).toBe(true);
    expect(patches[1].startsWith('diff --git a/beta.txt b/beta.txt')).toBe(true);
  });

  it('returns a single patch when input has no diff header', () => {
    const patch = '@@ -1 +1 @@\n-old\n+new';

    expect(splitDiffIntoFilePatches(patch)).toEqual([patch]);
  });
});

describe('parseDiffFiles', () => {
  it('extracts per-file paths and +/- counts from a multi-file patch', () => {
    expect(parseDiffFiles(multiFilePatch)).toEqual([
      { path: 'alpha.txt', additions: 1, deletions: 0 },
      { path: 'beta.txt', additions: 0, deletions: 1 },
    ]);
  });
});
