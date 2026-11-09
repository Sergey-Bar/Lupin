// The source of palettes.css: OpenCode's built-in dark themes, by their published palette hex.
// Regenerate with `node packages/ui/src/tokens/palettes.source.mjs`; palettes.test.ts holds the
// output to the same contrast floors the Lupin theme clears. Six values are lifted a step
// from upstream (tokyonight, nord and one-dark control edges; gruvbox, nord, one-dark red)
// because the upstream colour missed 4.5:1 text or 3:1 control contrast.
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** [sunken, surface, raised, muted, fg, fgMuted, border, borderStrong, accent, success, warning, danger, info] */
export const PALETTES = {
  opencode: [
    '#1a1717',
    '#201d1d',
    '#282424',
    '#302b2b',
    '#fdfcfc',
    '#b7b1b1',
    '#363030',
    '#7a7272',
    '#fab283',
    '#7fd88f',
    '#f5a742',
    '#e06c75',
    '#56b6c2',
  ],
  tokyonight: [
    '#16161e',
    '#1a1b26',
    '#1f2335',
    '#24283b',
    '#c0caf5',
    '#a9b1d6',
    '#292e42',
    '#68709c',
    '#7aa2f7',
    '#9ece6a',
    '#e0af68',
    '#f7768e',
    '#7dcfff',
  ],
  catppuccin: [
    '#11111b',
    '#1e1e2e',
    '#24243a',
    '#313244',
    '#cdd6f4',
    '#a6adc8',
    '#313244',
    '#6c7086',
    '#cba6f7',
    '#a6e3a1',
    '#f9e2af',
    '#f38ba8',
    '#89b4fa',
  ],
  gruvbox: [
    '#1d2021',
    '#282828',
    '#32302f',
    '#3c3836',
    '#ebdbb2',
    '#bdae93',
    '#3c3836',
    '#7c6f64',
    '#fe8019',
    '#b8bb26',
    '#fabd2f',
    '#fc6d58',
    '#83a598',
  ],
  nord: [
    '#242933',
    '#2e3440',
    '#3b4252',
    '#434c5e',
    '#eceff4',
    '#d8dee9',
    '#3b4252',
    '#7a87a2',
    '#88c0d0',
    '#a3be8c',
    '#ebcb8b',
    '#e48d95',
    '#81a1c1',
  ],
  everforest: [
    '#232a2e',
    '#2d353b',
    '#343f44',
    '#3d484d',
    '#d3c6aa',
    '#a7b0a3',
    '#3d484d',
    '#7a8478',
    '#a7c080',
    '#a7c080',
    '#dbbc7f',
    '#e67e80',
    '#7fbbb3',
  ],
  rosepine: [
    '#191724',
    '#1f1d2e',
    '#26233a',
    '#2a273f',
    '#e0def4',
    '#a8a5c4',
    '#26233a',
    '#6e6a86',
    '#c4a7e7',
    '#9ccfd8',
    '#f6c177',
    '#eb6f92',
    '#9ccfd8',
  ],
  kanagawa: [
    '#16161d',
    '#1f1f28',
    '#2a2a37',
    '#363646',
    '#dcd7ba',
    '#c8c093',
    '#2a2a37',
    '#727169',
    '#7e9cd8',
    '#98bb6c',
    '#e6c384',
    '#e46876',
    '#7fb4ca',
  ],
  dracula: [
    '#191a21',
    '#282a36',
    '#2f3140',
    '#383a4a',
    '#f8f8f2',
    '#c2c4d6',
    '#383a4a',
    '#6d7bad',
    '#bd93f9',
    '#50fa7b',
    '#f1fa8c',
    '#ff6e6e',
    '#8be9fd',
  ],
  'one-dark': [
    '#1e2127',
    '#282c34',
    '#2c313a',
    '#353b45',
    '#d7dae0',
    '#abb2bf',
    '#353b45',
    '#737a88',
    '#61afef',
    '#98c379',
    '#e5c07b',
    '#e8838b',
    '#56b6c2',
  ],
  ayu: [
    '#0b0e14',
    '#0f131a',
    '#131721',
    '#1a1f29',
    '#e6e1cf',
    '#b3b1ad',
    '#1f2430',
    '#5c6773',
    '#ffb454',
    '#aad94c',
    '#e6b450',
    '#f26d78',
    '#59c2ff',
  ],
  vesper: [
    '#0b0b0b',
    '#101010',
    '#161616',
    '#1c1c1c',
    '#ffffff',
    '#b0b0b0',
    '#232323',
    '#6a6a6a',
    '#ffc799',
    '#99ffe4',
    '#ffc799',
    '#ff8080',
    '#a0a0a0',
  ],
};

export const LABELS = {
  opencode: 'OpenCode',
  tokyonight: 'Tokyo Night',
  catppuccin: 'Catppuccin',
  gruvbox: 'Gruvbox',
  nord: 'Nord',
  everforest: 'Everforest',
  rosepine: 'Rosé Pine',
  kanagawa: 'Kanagawa',
  dracula: 'Dracula',
  'one-dark': 'One Dark',
  ayu: 'Ayu',
  vesper: 'Vesper',
};

function toOklch(hex) {
  const n = hex.replace('#', '');
  const lin = [0, 2, 4].map((i) => {
    const c = parseInt(n.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const [r, g, b] = lin;
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const C = Math.hypot(A, B);
  const H = ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360;
  return `oklch(${(L * 100).toFixed(2)}% ${C.toFixed(4)} ${C < 0.0005 ? '0' : H.toFixed(2)})`;
}

const KEYS = [
  'surface-sunken',
  'surface',
  'surface-raised',
  'surface-muted',
  'fg',
  'fg-muted',
  'border',
  'border-strong',
  'accent',
  'success',
  'warning',
  'danger',
  'info',
];

export function render() {
  const blocks = Object.entries(PALETTES).map(([name, hexes]) => {
    const lines = hexes.map((hex, i) => `  --lupin-${KEYS[i]}: ${toOklch(hex)};`);
    lines.push(
      `  --lupin-on-fill: ${toOklch(hexes[0])};`,
      `  --lupin-chart-grid: ${toOklch(hexes[3])};`,
      '  color-scheme: dark;',
    );
    return `/* ${LABELS[name]} */\n[data-palette='${name}'] {\n${lines.join('\n')}\n}`;
  });
  return `/*\n * OpenCode's dark themes as Lupin palettes. GENERATED by palettes.source.mjs: edit the hex there.\n *\n * A palette only re-points the --lupin-* tokens, so every component, the glass rule and the motion\n * rules are unchanged. No palette means the Lupin theme, light or dark. ThemeProvider sets\n * data-palette on <html> and forces the dark plane, because these themes are dark themes.\n */\n\n${blocks.join('\n\n')}\n`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = path.join(path.dirname(fileURLToPath(import.meta.url)), 'palettes.css');
  writeFileSync(out, render());
  console.log(`wrote ${path.relative(process.cwd(), out)}`);
}
