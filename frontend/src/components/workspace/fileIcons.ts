import {
  FileCode,
  FileJson,
  FileType,
  FileText,
  Image,
  Cog,
  Globe,
  Palette,
  type LucideIcon,
} from 'lucide-react';

interface FileIconInfo {
  icon: LucideIcon;
  className: string;
}

const extensionMap: Record<string, FileIconInfo> = {
  // Code files
  ts:   { icon: FileCode, className: 'text-blue-400' },
  tsx:  { icon: FileCode, className: 'text-blue-400' },
  js:   { icon: FileCode, className: 'text-yellow-400' },
  jsx:  { icon: FileCode, className: 'text-yellow-400' },
  go:   { icon: FileCode, className: 'text-cyan-400' },
  py:   { icon: FileCode, className: 'text-green-400' },
  rs:   { icon: FileCode, className: 'text-orange-400' },
  java: { icon: FileCode, className: 'text-red-400' },
  c:    { icon: FileCode, className: 'text-blue-300' },
  cpp:  { icon: FileCode, className: 'text-blue-300' },
  h:    { icon: FileCode, className: 'text-blue-300' },
  rb:   { icon: FileCode, className: 'text-red-400' },
  sh:   { icon: FileCode, className: 'text-green-300' },
  sql:  { icon: FileCode, className: 'text-purple-300' },

  // Data / config
  json: { icon: FileJson, className: 'text-yellow-300' },
  yaml: { icon: Cog, className: 'text-purple-300' },
  yml:  { icon: Cog, className: 'text-purple-300' },
  toml: { icon: Cog, className: 'text-purple-300' },
  env:  { icon: Cog, className: 'text-yellow-300' },

  // Markdown / docs
  md:   { icon: FileType, className: 'text-blue-200' },
  mdx:  { icon: FileType, className: 'text-blue-200' },

  // Styles
  css:  { icon: Palette, className: 'text-blue-400' },
  scss: { icon: Palette, className: 'text-pink-400' },
  less: { icon: Palette, className: 'text-blue-400' },

  // Images
  png:  { icon: Image, className: 'text-green-300' },
  jpg:  { icon: Image, className: 'text-green-300' },
  jpeg: { icon: Image, className: 'text-green-300' },
  svg:  { icon: Image, className: 'text-orange-300' },
  gif:  { icon: Image, className: 'text-green-300' },
  webp: { icon: Image, className: 'text-green-300' },
  ico:  { icon: Image, className: 'text-green-300' },

  // Web
  html: { icon: Globe, className: 'text-orange-400' },
  htm:  { icon: Globe, className: 'text-orange-400' },
};

const defaultIcon: FileIconInfo = { icon: FileText, className: 'text-dim' };

export function getFileIcon(name: string): FileIconInfo {
  const dotIdx = name.lastIndexOf('.');
  if (dotIdx < 0 || dotIdx === name.length - 1) return defaultIcon;
  const ext = name.slice(dotIdx + 1).toLowerCase();
  return extensionMap[ext] ?? defaultIcon;
}
