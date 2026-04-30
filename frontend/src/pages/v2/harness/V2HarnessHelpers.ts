import type { HarnessToolId, HarnessToolStatus, PiPackageEntry } from '../../../api/types';

export function normalizeHarnessVersion(version?: string) {
  if (!version) return undefined;
  return version.match(/\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?/)?.[0] ?? version;
}

export function toolIsStale(tool: HarnessToolStatus) {
  const currentVersion = normalizeHarnessVersion(tool.version);
  const latestVersion = normalizeHarnessVersion(tool.latestVersion);
  return Boolean(currentVersion && latestVersion && currentVersion !== latestVersion);
}

export function toolDisplayName(toolId: HarnessToolId | null, tools: HarnessToolStatus[]) {
  if (!toolId) return 'Harness';
  return tools.find((tool) => tool.id === toolId)?.name ?? toolId;
}

export function describePiPackage(pkg: PiPackageEntry) {
  const traits = [pkg.scope, pkg.sourceType];
  if (pkg.pinned) traits.push('pinned');
  if (pkg.filtered) traits.push('filtered');
  return traits.join(' / ');
}
