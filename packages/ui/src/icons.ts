/**
 * The icon set, and why it is a list rather than a re-export.
 *
 * **The dependency has to live in exactly one package.** `lucide-react` is a
 * dependency of `@lupin/ui` and not of `apps/web`, which pnpm's isolated
 * `node_modules` means an application component *cannot* import it — the first
 * version of `ThemeToggle` did exactly that and failed to resolve. Rather than add
 * a second dependency edge so a handful of files could draw a triangle, the icons
 * are exported from the package that already owns them.
 *
 * **A named list, not `export * from 'lucide-react'`.** Re-exporting the library
 * would make all sixteen hundred of them part of this package's public API, which
 * means a component reaching for `Wrench` would look like a deliberate choice when
 * it is just a name that happened to be in scope. A list is a decision, and it is
 * also what stops an icon — or an emoji — arriving one name at a time in whatever
 * component wanted it: adding one is a line in this file, which is the one place the
 * choice is made.
 *
 * **Only what is drawn.** Every name here is used by a component in this package or
 * in `apps/web`. A speculative icon is a name that looks available and gets used
 * without anyone deciding whether it is the right shape, which is the same failure
 * the list is meant to prevent.
 *
 * Names are the current lucide names. `AlertTriangle` is gone upstream in favour of
 * `TriangleAlert`, and `TrendingRight` does not exist, so a flat trend is `Minus` —
 * a trend that did not move is not a rightward trend.
 *
 * Every icon is rendered `aria-hidden` by its caller and paired with a name, because
 * the glyphs they replace were text with no name: a shape with neither an accessible
 * name nor a consistent appearance across platforms.
 */

import { createElement, forwardRef } from 'react';
import {
  ArrowRight as ArrowRightBase,
  ChevronLeft as ChevronLeftBase,
  ChevronRight as ChevronRightBase,
  PanelLeftClose as PanelLeftCloseBase,
  PanelLeftOpen as PanelLeftOpenBase,
  type LucideIcon,
  type LucideProps,
} from 'lucide-react';
import { cn } from './lib/utils.js';
export {
  /** Sort direction, ascending. Replaces `▲`, a geometric shape rather than a glyph. */
  ArrowUp,
  /** Sort direction, descending. Replaces `▼`. */
  ArrowDown,
  /** A metric that did not move. Replaces an em dash. */
  Minus,
  /** The `system` theme: whatever the operating system says. */
  Monitor,
  /** The `dark` theme. */
  Moon,
  /** The `light` theme. */
  Sun,
  /** `StatCard` trend up. Replaces `↑`. */
  TrendingUp,
  /** `StatCard` trend down. Replaces `↓`. */
  TrendingDown,
  /** Runs a tool. The runner page's one primary action. */
  Play,
  /** Re-reads the repository rather than serving the cached scan. */
  RefreshCw,
  /** A capability the repository covers. */
  Check,
  /** A capability the repository does not cover. */
  X,
  /** A link that leaves the product: a tool's documentation. */
  ExternalLink,
  /** The filter field on the runner and toolbox pages. */
  Search,
  // One glyph per QA capability, so the toolbox and the runner read as a launcher: the
  // shape names the kind of tool before the label does. Each is paired with its name.
  FlaskConical,
  Layers,
  Globe,
  ChartPie,
  ScanSearch,
  Braces,
  Pilcrow,
  ShieldCheck,
  KeyRound,
  Package,
  Gauge,
  Accessibility,
  Bug,
  Handshake,
  Eye,
  Workflow,
  /** The menu button's chevron: it opens a list of actions below it. */
  ChevronDown,
  Hammer,
  Database,
  BookOpen,
  Terminal,
  Wrench,
  /** Copies a command or a link. */
  Copy,
  /** Opens the navigation on a narrow screen. */
  Menu,
  /** Pins a tool to the top of the runner. */
  Star,
  /** Runs a finished command again. */
  RotateCcw,
  /** The four capabilities the expanded toolbox added: mobile, API, DAST, test management. */
  Smartphone,
  Webhook,
  Radar,
  ClipboardList,
  /** The insights page: activity, duration, branches, the flaky leaderboard and the digest. */
  Activity,
  Timer,
  GitBranch,
  Flame,
  Sparkles,
  /** The readiness verdicts: go, caution, unknown, no-go. */
  CircleCheck,
  CircleAlert,
  CircleHelp,
  OctagonX,
  /** The four sections, in the bottom tab bar: Overview, Runs, Insights, Map. */
  LayoutGrid,
  ListChecks,
  Network,
  /** The repo map's "show the blocking path" toggle. */
  Route,
  /** The Settings section: a gear, the one place a reader changes how the product behaves. */
  Settings,
} from 'lucide-react';

/**
 * The icons whose meaning is a direction along the reading line.
 *
 * Mirrored in a right-to-left page by the 
tl: variant, so "next" still points the way a
 * reader's eye travels. Done here, once, so a call site cannot forget. Icons about the screen
 * rather than the reading line (the sort arrows, a trend) are not mirrored.
 */
function mirrored(Icon: LucideIcon): LucideIcon {
  const Mirrored = forwardRef<SVGSVGElement, LucideProps>(({ className, ...props }, ref) =>
    createElement(Icon, { ...props, ref, className: cn('rtl:-scale-x-100', className) }),
  );
  Mirrored.displayName = Icon.displayName ?? 'MirroredIcon';
  return Mirrored;
}

/** The sidebar is expanded; the control collapses it. */
export const PanelLeftClose = mirrored(PanelLeftCloseBase);
/** The sidebar is collapsed; the control expands it. */
export const PanelLeftOpen = mirrored(PanelLeftOpenBase);
/** Pager: the previous page. */
export const ChevronLeft = mirrored(ChevronLeftBase);
/** Pager: the next page. */
export const ChevronRight = mirrored(ChevronRightBase);
/** A finding's next action: "Fix", "Open". */
export const ArrowRight = mirrored(ArrowRightBase);
