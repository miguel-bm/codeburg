import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Search, X } from 'lucide-react';
import { Card } from './Card';
import { Select } from './Select';
import type { SelectOption } from './Select';
import { SectionBody, SectionCard } from './settings';

export type SettingsShellSection<TGroup extends string = string> = {
  id: string;
  group: TGroup;
  title: string;
  description: string;
  keywords?: string[];
  icon?: React.ReactNode;
  content: React.ReactNode;
};

interface SettingsShellProps<TGroup extends string> {
  sections: SettingsShellSection<TGroup>[];
  groupLabels: Record<TGroup, string>;
  groupOrder?: TGroup[];
  initialSectionId?: string;
  navTitle?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  compactBreakpoint?: number;
  forceCompact?: boolean;
  className?: string;
}

function uniqueGroupOrder<TGroup extends string>(sections: SettingsShellSection<TGroup>[]) {
  const seen = new Set<TGroup>();
  const order: TGroup[] = [];
  for (const section of sections) {
    if (seen.has(section.group)) continue;
    seen.add(section.group);
    order.push(section.group);
  }
  return order;
}

export function SettingsShell<TGroup extends string>({
  sections,
  groupLabels,
  groupOrder,
  initialSectionId,
  navTitle = 'All settings',
  searchPlaceholder = 'Search settings',
  emptyMessage = 'No settings sections match your search.',
  compactBreakpoint = 980,
  forceCompact = false,
  className = '',
}: SettingsShellProps<TGroup>) {
  const [search, setSearch] = useState('');
  const [activeSectionId, setActiveSectionId] = useState(initialSectionId ?? sections[0]?.id ?? '');
  const [searchInputUnlocked, setSearchInputUnlocked] = useState(false);
  const [containerWidth, setContainerWidth] = useState(
    typeof window !== 'undefined' ? window.innerWidth : compactBreakpoint + 1,
  );
  const searchInputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const normalizedSearch = search.trim().toLowerCase();

  const filteredSections = useMemo(() => {
    if (!normalizedSearch) return sections;
    return sections.filter((section) => {
      const haystack = `${section.title} ${section.description} ${(section.keywords ?? []).join(' ')}`.toLowerCase();
      return haystack.includes(normalizedSearch);
    });
  }, [sections, normalizedSearch]);

  const orderedGroups = useMemo(() => {
    if (!groupOrder || groupOrder.length === 0) return uniqueGroupOrder(filteredSections);
    const filteredGroupSet = new Set<TGroup>(filteredSections.map((section) => section.group));
    const explicit = groupOrder.filter((group) => filteredGroupSet.has(group));
    const remainder = uniqueGroupOrder(filteredSections).filter((group) => !explicit.includes(group));
    return [...explicit, ...remainder];
  }, [filteredSections, groupOrder]);

  const groupedSections = useMemo(() => (
    orderedGroups.map((group) => ({
      group,
      label: groupLabels[group] ?? group,
      items: filteredSections.filter((section) => section.group === group),
    }))
  ), [orderedGroups, groupLabels, filteredSections]);

  const orderedFilteredSections = useMemo(
    () => groupedSections.flatMap((group) => group.items),
    [groupedSections],
  );

  const activeSection = orderedFilteredSections.find((section) => section.id === activeSectionId) ?? null;
  const activeSectionIndex = orderedFilteredSections.findIndex((section) => section.id === activeSection?.id);

  const sectionSelectOptions = useMemo<SelectOption<string>[]>(() => (
    orderedFilteredSections.map((section) => ({
      value: section.id,
      label: section.title,
      description: groupLabels[section.group] ?? section.group,
    }))
  ), [orderedFilteredSections, groupLabels]);

  const compactByWidth = containerWidth < compactBreakpoint;
  const isCompact = forceCompact || compactByWidth;

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;

    const update = () => setContainerWidth(node.clientWidth);
    update();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', update);
      return () => window.removeEventListener('resize', update);
    }

    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      setContainerWidth(width ?? node.clientWidth);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    if (orderedFilteredSections.length === 0) {
      if (activeSectionId !== '') {
        timer = setTimeout(() => setActiveSectionId(''), 0);
      }
      return () => {
        if (timer) clearTimeout(timer);
      };
    }

    const hasActive = orderedFilteredSections.some((section) => section.id === activeSectionId);
    if (!hasActive) {
      timer = setTimeout(() => setActiveSectionId(orderedFilteredSections[0].id), 0);
    }
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [orderedFilteredSections, activeSectionId]);

  useEffect(() => {
    if (!initialSectionId) return;
    const timer = setTimeout(() => setActiveSectionId(initialSectionId), 0);
    return () => clearTimeout(timer);
  }, [initialSectionId]);

  useEffect(() => {
    const handleKeydown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setSearchInputUnlocked(true);
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
        return;
      }

      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      if (orderedFilteredSections.length === 0) return;

      const target = e.target as HTMLElement | null;
      const tagName = target?.tagName.toLowerCase();
      const isEditable = Boolean(
        target?.isContentEditable
          || tagName === 'input'
          || tagName === 'textarea'
          || tagName === 'select',
      );
      const isInsideSelect = Boolean(target?.closest('[data-settings-skip-nav-hotkeys="true"]'));

      if (isEditable || isInsideSelect) return;

      e.preventDefault();
      const currentIndex = activeSectionIndex >= 0 ? activeSectionIndex : 0;
      const nextIndex = e.key === 'ArrowDown'
        ? (currentIndex + 1) % orderedFilteredSections.length
        : (currentIndex - 1 + orderedFilteredSections.length) % orderedFilteredSections.length;
      setActiveSectionId(orderedFilteredSections[nextIndex].id);
    };

    window.addEventListener('keydown', handleKeydown);
    return () => window.removeEventListener('keydown', handleKeydown);
  }, [orderedFilteredSections, activeSectionIndex]);

  return (
    <div ref={containerRef} className={`flex flex-col h-full ${className}`}>
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-6xl mx-auto w-full px-3 sm:px-6 py-4 md:py-6">
          <div className={`grid grid-cols-1 gap-4 md:gap-6 items-start ${isCompact ? '' : 'md:grid-cols-[280px_minmax(0,1fr)]'}`}>
            <Card padding="none" variant="elevated" className={`overflow-hidden ${isCompact ? '' : 'md:sticky md:top-4'}`}>
              <div className="px-4 py-3 border-b border-subtle">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-medium text-[var(--color-text-primary)]">{navTitle}</p>
                  <p className="text-xs text-[var(--color-text-secondary)]">{orderedFilteredSections.length}</p>
                </div>
                <div className="relative">
                  <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-secondary)]" />
                  <input
                    ref={searchInputRef}
                    id="settings-shell-search"
                    type="text"
                    name="q_settings_filter"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    onFocus={() => {
                      if (!searchInputUnlocked) {
                        setSearchInputUnlocked(true);
                      }
                    }}
                    placeholder={searchPlaceholder}
                    readOnly={!searchInputUnlocked}
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    inputMode="search"
                    data-form-type="other"
                    data-lpignore="true"
                    data-1p-ignore="true"
                    data-bwignore="true"
                    className="w-full pl-8 pr-9 py-2 rounded-xl border border-subtle bg-primary text-sm text-[var(--color-text-primary)] focus:outline-none focus:border-accent transition-colors"
                  />
                  {search && (
                    <button
                      onClick={() => setSearch('')}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
                      aria-label="Clear search"
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
                {!isCompact && (
                  <p className="text-[10px] text-[var(--color-text-secondary)] mt-2 flex items-center gap-1.5 flex-wrap">
                    <kbd className="px-1 py-0.5 rounded border border-subtle bg-secondary text-[var(--color-text-primary)]">Ctrl/Cmd+F</kbd>
                    {' '}search
                    {' \u00b7 '}
                    <kbd className="px-1 py-0.5 rounded border border-subtle bg-secondary text-[var(--color-text-primary)] inline-flex items-center"><ArrowUp size={11} /></kbd>
                    {' '}
                    <kbd className="px-1 py-0.5 rounded border border-subtle bg-secondary text-[var(--color-text-primary)] inline-flex items-center"><ArrowDown size={11} /></kbd>
                    {' '}navigate
                  </p>
                )}
              </div>

              <nav className={`${isCompact ? 'px-3 py-3 border-b border-subtle' : 'hidden'}`} data-settings-skip-nav-hotkeys="true">
                {filteredSections.length === 0 ? (
                  <p className="text-sm text-dim px-1 py-2">{emptyMessage}</p>
                ) : (
                  <div>
                    <p className="text-xs text-[var(--color-text-primary)] mb-2 px-1">Section</p>
                    <Select
                      value={activeSection?.id ?? orderedFilteredSections[0].id}
                      onChange={setActiveSectionId}
                      options={sectionSelectOptions}
                      className="[&>button]:rounded-xl [&>button]:py-2.5"
                    />
                  </div>
                )}
              </nav>

              <nav className={`${isCompact ? 'hidden' : 'hidden md:block p-2 max-h-[calc(100vh-14rem)] overflow-y-auto'}`}>
                {groupedSections.length === 0 ? (
                  <p className="text-sm text-[var(--color-text-secondary)] px-2 py-3">{emptyMessage}</p>
                ) : (
                  groupedSections.map((group) => (
                    <div key={group.group} className="mb-2.5 last:mb-0">
                      <p className="px-2 py-1 text-[11px] text-[var(--color-text-secondary)]">
                        {group.label}
                      </p>
                      <div className="space-y-1">
                        {group.items.map((section) => (
                          <button
                            key={section.id}
                            onClick={() => setActiveSectionId(section.id)}
                            className={`relative group w-full text-left px-3 py-2.5 rounded-xl border transition-colors ${
                              activeSection?.id === section.id
                                ? 'bg-accent/15 border-accent/55'
                                : 'border-transparent hover:border-subtle hover:bg-primary'
                            }`}
                          >
                            <span className={`absolute left-0.5 top-2 bottom-2 w-[3px] rounded-full transition-opacity ${activeSection?.id === section.id ? 'opacity-100 bg-accent' : 'opacity-0'}`} />
                            <div className="flex items-start gap-2.5">
                              <span
                                className={`mt-0.5 flex h-7 w-7 items-center justify-center rounded-[10px] border transition-colors ${
                                  activeSection?.id === section.id
                                    ? 'border-accent/50 bg-accent/20 text-accent'
                                    : 'border-subtle bg-primary text-[var(--color-text-secondary)] group-hover:text-[var(--color-text-primary)]'
                                }`}
                              >
                                {section.icon}
                              </span>
                              <div className="min-w-0">
                                <p className={`text-sm leading-tight ${activeSection?.id === section.id ? 'text-[var(--color-text-primary)]' : 'text-[var(--color-text-secondary)] group-hover:text-[var(--color-text-primary)]'}`}>
                                  {section.title}
                                </p>
                                <p className="text-xs text-[var(--color-text-secondary)] mt-1 line-clamp-2">{section.description}</p>
                              </div>
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  ))
                )}
              </nav>
            </Card>

            <section className="min-w-0">
              {activeSection ? (
                <div className="space-y-3">
                  <div className="px-1 md:px-0">
                    <div className="inline-flex items-center gap-2 rounded-full px-2.5 py-1 border border-subtle bg-secondary">
                      {activeSection.icon && <span className="text-accent">{activeSection.icon}</span>}
                      <span className="text-xs text-[var(--color-text-secondary)]">{groupLabels[activeSection.group] ?? activeSection.group}</span>
                    </div>
                  </div>
                  <div key={activeSection.id} className="transition-opacity duration-150">
                    {activeSection.content}
                  </div>
                </div>
              ) : (
                <SectionCard>
                  <SectionBody>
                    <p className="text-sm text-dim">{emptyMessage}</p>
                  </SectionBody>
                </SectionCard>
              )}
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
