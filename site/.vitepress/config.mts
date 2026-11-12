import { defineConfig } from 'vitepress';
import { translations, githubUrl } from './locales';

/*
 * Share metadata. A crawler does not resolve a relative URL, so the preview image is absolute
 * when `SITE_URL` (the Pages origin, e.g. https://owner.github.io) is set, which the deploy
 * workflow does. Locally it falls back to a path under the base.
 */
const SITE_BASE = process.env.SITE_BASE ?? '/';
const SITE_URL = process.env.SITE_URL ?? '';
const SITE_TITLE = 'Lupin: test evidence and release decisions, self-hosted';
const SITE_DESCRIPTION =
  'A self-hosted QA control plane for test evidence, quality gates and flaky-test quarantine';
const OG_IMAGE = `${SITE_URL}${SITE_BASE}og-image.png`;

export default defineConfig({
  title: 'Lupin',
  appearance: false,
  head: [
    [
      'script',
      {},
      `(function(){var mode='light';try{mode=localStorage.getItem('lupin-site-theme')||'light'}catch(e){}var dark=mode==='dark'||(mode==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',dark);document.documentElement.setAttribute('data-theme',dark?'dark':'light')})()`,
    ],
    ['meta', { name: 'theme-color', content: '#FAFAF9', media: '(prefers-color-scheme: light)' }],
    ['meta', { name: 'theme-color', content: '#101114', media: '(prefers-color-scheme: dark)' }],
    ['meta', { property: 'og:site_name', content: 'Lupin' }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:title', content: SITE_TITLE }],
    ['meta', { property: 'og:description', content: SITE_DESCRIPTION }],
    ['meta', { property: 'og:image', content: OG_IMAGE }],
    ['meta', { property: 'og:image:width', content: '1200' }],
    ['meta', { property: 'og:image:height', content: '630' }],
    [
      'meta',
      {
        property: 'og:image:alt',
        content: 'The Lupin wordmark and the line "Know what broke. Know whether to ship."',
      },
    ],
    ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
    ['link', { rel: 'icon', type: 'image/svg+xml', href: `${SITE_BASE}favicon.svg` }],
  ],
  locales: Object.fromEntries(
    translations.map((copy) => [
      copy.code === 'en' ? 'root' : copy.code,
      {
        label: copy.label,
        lang: copy.lang,
        dir: ['ar', 'he'].includes(copy.code) ? 'rtl' : 'ltr',
        link: copy.code === 'en' ? '/' : `/${copy.code}/`,
        description: copy.description,
        themeConfig:
          copy.code === 'en'
            ? {}
            : {
                nav: [
                  { text: 'Lupin', link: `/${copy.code}/` },
                  { text: copy.docs, link: '/guide/' },
                  { text: copy.start, link: '/guide/install' },
                ],
                sidebar: [],
              },
      },
    ]),
  ),
  description: SITE_DESCRIPTION,
  // Mermaid diagrams on the guide pages are rendered as code blocks; the source is the
  // diagram, and GitHub renders the same block natively.
  // A GitHub project page is served from `/<repo>/`, so the base has to be set or
  // every asset URL resolves one level too high and the site renders unstyled.
  //
  // Defaults to `/` for local work. `.github/workflows/docs.yml` publishes this site to
  // GitHub Pages and passes `SITE_BASE=/<repo>/` (and `SITE_URL`, for the share image);
  // a build that renders unstyled is the visible failure if it ever forgets to.
  base: SITE_BASE,
  // `dist`, not VitePress's default `.vitepress/dist`.
  //
  // Two existing rules then cover the output without being extended: turbo's
  // `build` task caches `dist/**`, and the repository's `dist/` gitignore rule
  // already excludes it. Keeping the default would mean one of the two no longer
  // applies, and the first thing that fails is the secret scan reading minified
  // output as text.
  outDir: 'dist',
  cleanUrls: true,
  lastUpdated: true,
  // `srcDir` points at `site/pages`, not at the package root.
  //
  // The home page is `site/index.md` because VitePress resolves `/` from the
  // srcDir, so it has to be in the same place as everything else — and it is,
  // because a *generated* file cannot be written into the package root without a
  // build step that would fight the checkout. `pnpm site:generate` writes the
  // status pages here; the three of them carry a marker and the generator refuses
  // to overwrite a page without one, so a hand-written page is a conflict rather
  // than something a build overwrites.
  srcDir: '.',
  themeConfig: {
    socialLinks: [{ icon: 'github', link: githubUrl, ariaLabel: 'Lupin on GitHub' }],
    nav: [
      { text: 'Product', link: '/#product' },
      { text: 'How it works', link: '/#how-it-works' },
      { text: 'Documentation', link: '/guide/' },
      { text: 'Get started', link: '/guide/install' },
    ],
    /**
     * Section landing pages, and the sidebar points at them.
     *
     * `guide/index.md`, `pages/index.md` and `pages/quality/index.md` exist so a reader
     * who lands in a section has something to land *on*. Without them VitePress puts a
     * section heading in the sidebar that goes nowhere, which is worse than not grouping
     * at all: it looks like navigation and is not.
     *
     * The trailing slashes matter. `link: '/guide'` resolves to the section's `index.md`
     * only because `cleanUrls` is on and VitePress rewrites it; the explicit `/guide/`
     * is what the build and `site-doctor` check 4 compare against, and it is the form
     * that survives being copied out of the address bar.
     */
    sidebar: [
      {
        text: 'Get started',
        items: [
          { text: 'Start here · choose your goal', link: '/guide/' },
          { text: 'Install', link: '/guide/install' },
          { text: 'Getting started', link: '/guide/getting-started' },
          { text: 'Sending results', link: '/guide/sending-results' },
          { text: 'Choose a profile', link: '/guide/profiles' },
        ],
      },
      {
        text: 'Use Lupin',
        collapsed: false,
        items: [
          { text: 'Core concepts', link: '/guide/concepts' },
          { text: 'Quality gates and quarantine', link: '/guide/quality-gates' },
          { text: 'Repository health', link: '/guide/repository-health' },
          { text: 'Delivery performance', link: '/guide/delivery-performance' },
          { text: 'Scheduled reports', link: '/guide/notifications' },
          { text: 'AI-written code', link: '/guide/ai-code' },
          { text: 'Change risk', link: '/guide/change-risk' },
          { text: 'Phases, pace and shape', link: '/guide/phases-and-pace' },
          { text: 'The briefing', link: '/guide/briefing' },
          { text: 'Agent quality', link: '/guide/agents' },
          { text: 'Issues and test proposals', link: '/guide/issues-and-test-proposals' },
          { text: 'How Lupin compares', link: '/guide/compare' },
        ],
      },
      {
        text: 'Integrations',
        collapsed: true,
        items: [
          { text: 'Send results from any CI (CLI)', link: '/guide/cli' },
          { text: 'Embedded and firmware QA', link: '/guide/embedded' },
          { text: 'GitHub command center', link: '/guide/github-command-center' },
          { text: 'Ask your editor (MCP)', link: '/guide/mcp' },
          { text: 'Serve your network (LAN mode)', link: '/guide/lan-mode' },
          { text: 'Reach it from anywhere (Cloudflare)', link: '/guide/remote-cloudflare' },
        ],
      },
      {
        text: 'Reference',
        collapsed: true,
        items: [
          { text: 'Reference', link: '/pages/' },
          { text: 'Words explained', link: '/guide/glossary' },
          { text: 'Architecture', link: '/architecture' },
          { text: 'Operations', link: '/operations' },
        ],
      },
      {
        text: 'Project',
        collapsed: true,
        items: [
          { text: 'How this repository tests itself', link: '/guide/testing-strategy' },
          { text: 'How this project is maintained', link: '/guide/maintenance' },
          { text: 'The design language', link: '/guide/design-language' },
          { text: 'Quality', link: '/pages/quality/' },
          { text: 'Capabilities', link: '/pages/capabilities' },
          { text: 'Findings', link: '/pages/quality/findings' },
          { text: 'Coverage', link: '/pages/quality/coverage' },
          { text: '10/10', link: '/pages/quality/ten' },
        ],
      },
    ],
    search: { provider: 'local' },
  },
});
