/**
 * The palettes a reader can choose, by the name `palettes.css` keys on. Names and labels only:
 * the colours live in `palettes.source.mjs`, and `palettes.test.ts` holds the two lists equal.
 * `lupin` is the product's own theme and means "no palette".
 */
export const PALETTE_OPTIONS = [
  { value: 'lupin', label: 'Lupin' },
  { value: 'opencode', label: 'OpenCode' },
  { value: 'tokyonight', label: 'Tokyo Night' },
  { value: 'catppuccin', label: 'Catppuccin' },
  { value: 'gruvbox', label: 'Gruvbox' },
  { value: 'nord', label: 'Nord' },
  { value: 'everforest', label: 'Everforest' },
  { value: 'rosepine', label: 'Rosé Pine' },
  { value: 'kanagawa', label: 'Kanagawa' },
  { value: 'dracula', label: 'Dracula' },
  { value: 'one-dark', label: 'One Dark' },
  { value: 'ayu', label: 'Ayu' },
  { value: 'vesper', label: 'Vesper' },
] as const;

export type Palette = (typeof PALETTE_OPTIONS)[number]['value'];

export function isPalette(value: unknown): value is Palette {
  return PALETTE_OPTIONS.some((option) => option.value === value);
}
