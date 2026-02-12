import { useState, useCallback } from 'react';
import { Search, ToggleLeft, ToggleRight } from 'lucide-react';
import { useWorkspaceFiles } from '../../hooks/useWorkspaceFiles';
import { useWorkspaceStore } from '../../stores/workspace';

export function FileSearchPanel() {
  const { search, searchResults, isSearching } = useWorkspaceFiles();
  const { openFile } = useWorkspaceStore();
  const [query, setQuery] = useState('');
  const [useRegex, setUseRegex] = useState(false);

  const handleSearch = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (!query.trim()) return;
      search({ query: query.trim(), regex: useRegex });
    },
    [query, useRegex, search],
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSearch(e);
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <form onSubmit={handleSearch} className="px-2 py-2 border-b border-subtle space-y-1.5">
        <div className="relative">
          <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-dim" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search in files..."
            className="w-full pl-7 pr-2 py-1.5 text-xs bg-primary border border-subtle rounded-md focus:border-accent focus:outline-none"
            autoFocus
          />
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setUseRegex(!useRegex)}
            className={`flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded ${
              useRegex ? 'text-accent bg-accent/10' : 'text-dim hover:text-[var(--color-text-primary)]'
            }`}
            title="Use regex"
          >
            {useRegex ? <ToggleRight size={12} /> : <ToggleLeft size={12} />}
            Regex
          </button>
        </div>
      </form>

      <div className="flex-1 overflow-auto">
        {isSearching && (
          <div className="flex items-center justify-center h-16 text-xs text-dim">Searching...</div>
        )}
        {searchResults && searchResults.length === 0 && !isSearching && (
          <div className="flex items-center justify-center h-16 text-xs text-dim">No results found</div>
        )}
        {searchResults?.map((result) => (
          <div key={result.file} className="border-b border-subtle">
            <div className="px-2 py-1 text-[10px] font-medium text-accent truncate bg-secondary">
              {result.file}
            </div>
            {result.matches.map((match, i) => (
              <button
                key={i}
                onClick={() => openFile(result.file, match.line)}
                className="w-full text-left px-3 py-0.5 text-[11px] text-dim hover:bg-tertiary hover:text-[var(--color-text-primary)] transition-colors flex items-baseline gap-2"
              >
                <span className="text-dim/60 tabular-nums shrink-0">{match.line}</span>
                <span className="truncate font-mono">{match.content}</span>
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
