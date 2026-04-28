import { useMemo, useState, useCallback } from 'react';
import { CaseSensitive, FileSearch, Regex, Search } from 'lucide-react';
import { useWorkspaceFiles } from '../../hooks/useWorkspaceFiles';
import { useWorkspaceNav } from '../../hooks/useWorkspaceNav';
import {
  WorkbenchEmpty,
  WorkbenchFrame,
  WorkbenchIconButton,
  WorkbenchMeta,
  WorkbenchRow,
  WorkbenchSearchInput,
  WorkbenchToolbar,
} from './WorkspaceWorkbench';

export function FileSearchPanel() {
  const { search, searchResults, isSearching, searchError } = useWorkspaceFiles();
  const { openFile } = useWorkspaceNav();
  const [query, setQuery] = useState('');
  const [useRegex, setUseRegex] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [activeMatch, setActiveMatch] = useState<string | null>(null);

  const resultCount = useMemo(
    () => searchResults?.reduce((total, result) => total + result.matches.length, 0) ?? 0,
    [searchResults],
  );

  const handleSearch = useCallback(
    (event: React.FormEvent) => {
      event.preventDefault();
      if (!query.trim()) return;
      search({ query: query.trim(), regex: useRegex, caseSensitive });
    },
    [caseSensitive, query, search, useRegex],
  );

  return (
    <WorkbenchFrame>
      <WorkbenchToolbar onSubmit={handleSearch} className="space-y-1.5">
        <div className="flex items-center gap-1.5">
          <WorkbenchSearchInput
            icon={<Search size={13} />}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find in workspace"
            autoFocus
          />
          <WorkbenchIconButton
            active={useRegex}
            label={useRegex ? 'Regex enabled' : 'Use regex'}
            onClick={() => setUseRegex((value) => !value)}
          >
            <Regex size={14} />
          </WorkbenchIconButton>
          <WorkbenchIconButton
            active={caseSensitive}
            label={caseSensitive ? 'Case sensitive enabled' : 'Match case'}
            onClick={() => setCaseSensitive((value) => !value)}
          >
            <CaseSensitive size={15} />
          </WorkbenchIconButton>
        </div>
        {searchResults && (
          <div className="flex items-center gap-1.5 px-0.5 text-[11px] text-dim">
            <WorkbenchMeta>{resultCount} match{resultCount === 1 ? '' : 'es'}</WorkbenchMeta>
            <span className="truncate">for {query.trim()}</span>
          </div>
        )}
      </WorkbenchToolbar>

      <div className="min-h-0 flex-1 overflow-auto px-1 pb-3">
        {isSearching && (
          <WorkbenchEmpty compact icon={<FileSearch size={18} />} title="Searching" />
        )}

        {searchError && !isSearching && (
          <WorkbenchEmpty
            compact
            icon={<FileSearch size={18} />}
            title="Search failed"
            body={searchError instanceof Error ? searchError.message : String(searchError)}
          />
        )}

        {!searchResults && !searchError && !isSearching && (
          <WorkbenchEmpty
            icon={<FileSearch size={20} />}
            title="Search workspace"
            body="Enter text above, then press Return."
          />
        )}

        {searchResults && searchResults.length === 0 && !isSearching && (
          <WorkbenchEmpty
            compact
            icon={<FileSearch size={18} />}
            title="No results"
            body="Try a different query or turn off regex."
          />
        )}

        {searchResults?.map((result) => (
          <section key={result.file} className="py-1">
            <div className="flex min-h-8 items-center gap-2 px-2.5 text-[11px]">
              <span className="min-w-0 flex-1 truncate font-mono text-[var(--color-text-primary)]">{result.file}</span>
              <WorkbenchMeta>{result.matches.length}</WorkbenchMeta>
            </div>
            <div className="space-y-0.5">
              {result.matches.map((match, index) => {
                const key = `${result.file}:${match.line}:${index}`;
                return (
                  <WorkbenchRow
                    key={key}
                    active={activeMatch === key}
                    onClick={() => {
                      setActiveMatch(key);
                      openFile(result.file, match.line);
                    }}
                    className="items-baseline"
                  >
                    <span className="w-8 shrink-0 text-right font-mono text-[10px] tabular-nums text-dim/75">
                      {match.line}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-[var(--color-text-secondary)]">
                      {match.content}
                    </span>
                  </WorkbenchRow>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </WorkbenchFrame>
  );
}
