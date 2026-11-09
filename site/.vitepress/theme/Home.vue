<script setup lang="ts">
import { withBase } from 'vitepress';
import runsPreview from '../../../docs/assets/runs.png';
import runDetailPreview from '../../../docs/assets/run-detail.png';
import { githubUrl } from '../locales';

/**
 * The hero's release decision is drawn in HTML, not as a picture: it is the product's
 * argument in one card, so it has to be readable, translatable and selectable. Every verdict
 * is a word beside its dot, because colour is never the only carrier.
 */
const decision = {
  release: 'Release 2.4.0',
  branch: 'release/2.4',
  verdict: 'Blocked',
  rows: [
    { domain: 'Browser tests', detail: '2 of 148 failed', word: 'Failed', tone: 'bad' },
    { domain: 'Flaky', detail: 'checkout › basket refresh', word: 'Quarantined', tone: 'warn' },
    { domain: 'API contract', detail: '312 of 312 passed', word: 'Passed', tone: 'good' },
    {
      domain: 'Security scan',
      detail: 'no scanner connected',
      word: 'Not configured',
      tone: 'unknown',
    },
  ],
  footer: 'Decided from 4 runs on 7d02b5f · evidence attached',
} as const;

const stages = [
  {
    title: 'Observe',
    text: 'Results arrive from the tools you already run: Playwright, JUnit, k6, ZAP and Allure.',
    link: '/guide/sending-results',
    action: 'Connect your test tools',
  },
  {
    title: 'Investigate',
    text: 'Each failure keeps its retries, its error and the report it came from.',
    link: '/guide/concepts',
    action: 'Follow a test result',
  },
  {
    title: 'Decide',
    text: 'A gate says pass, fail, or unknown. Missing evidence is a state, never a silent pass.',
    link: '/guide/quality-gates',
    action: 'Understand quality gates',
  },
];

const capabilities = [
  {
    title: 'One result model',
    text: 'Every producer lands in the same shape, so a JUnit failure and a Playwright failure read alike.',
    link: '/guide/sending-results',
  },
  {
    title: 'Evidence stays attached',
    text: 'Original reports, traces and artifacts stay linked to the result they explain.',
    link: '/guide/concepts',
  },
  {
    title: 'Flaky tests, named',
    text: 'A pass on the third retry is shown as a retry, not counted as reliability.',
    link: '/guide/concepts#test-statuses',
  },
  {
    title: 'Gates that admit gaps',
    text: '“Unknown” and “not configured” are outcomes. A release is never green by omission.',
    link: '/guide/quality-gates',
  },
  {
    title: 'Quarantine with a reason',
    text: 'Park a known flaky test with who, why and when, and an audit trail behind it.',
    link: '/guide/quality-gates',
  },
  {
    title: 'Yours to host',
    text: 'One Docker Compose stack on your hardware. Pick the access profile your team needs.',
    link: '/guide/profiles',
  },
];

const integrations = [
  ['Playwright', 'Live reporter + JSON import'],
  ['JUnit', 'XML report import'],
  ['k6', 'Summary JSON import'],
  ['OWASP ZAP', 'XML report import'],
  ['Allure', 'Results importer'],
];

/** The three commands are the guides' own (install.md, cli.md); the quick start does not invent one. */
const quickStart = [
  {
    title: 'Start Lupin',
    command: './start.sh',
    note: 'From the extracted release. Windows uses .\\start.cmd. Needs Docker with Compose v2.',
    link: '/guide/install',
  },
  {
    title: 'Send a test run',
    command:
      'lupin test --format playwright-json --report results.json -- npx playwright test --reporter=json',
    note: 'The CLI wraps your existing command and uploads what it produced.',
    link: '/guide/cli',
  },
  {
    title: 'Gate the pull request',
    command: 'lupin gate --branch "$BRANCH" --commit "$SHA" --pr 42',
    note: 'Exits non-zero when the gate fails, so CI blocks the merge.',
    link: '/guide/quality-gates',
  },
];
</script>

<template>
  <main class="lupin-home">
    <section class="lupin-hero" aria-labelledby="hero-title">
      <div class="lupin-hero-copy">
        <p class="lupin-kicker lupin-arrive">
          <span aria-hidden="true"></span> Self-hosted QA control plane
        </p>
        <h1 id="hero-title" class="lupin-arrive">
          Know what broke.<br /><span>Know whether to ship.</span>
        </h1>
        <p class="lupin-lead lupin-arrive">
          Lupin collects test results and their evidence, names the flaky ones, and turns them into
          a release decision you can defend. On your own infrastructure.
        </p>
        <div class="lupin-actions lupin-arrive">
          <a class="lupin-button primary" :href="withBase('/guide/install')"
            >Get started <span aria-hidden="true">→</span></a
          ><a class="lupin-button" :href="githubUrl" target="_blank" rel="noopener noreferrer"
            >View on GitHub <span aria-hidden="true">↗</span></a
          >
        </div>
        <p class="lupin-hero-note lupin-arrive">
          Open source · MIT licensed · Runs on your hardware
        </p>
      </div>

      <figure
        class="lupin-decision lupin-arrive"
        aria-label="Example release decision: Release 2.4.0 is blocked"
      >
        <header>
          <div>
            <strong>{{ decision.release }}</strong>
            <span class="lupin-mono">{{ decision.branch }}</span>
          </div>
          <span class="lupin-verdict" data-tone="bad">
            <span class="lupin-dot" data-tone="bad" aria-hidden="true"></span>{{ decision.verdict }}
          </span>
        </header>
        <ul>
          <li v-for="row in decision.rows" :key="row.domain">
            <span class="lupin-dot" :data-tone="row.tone" aria-hidden="true"></span>
            <span class="lupin-decision-domain">{{ row.domain }}</span>
            <span class="lupin-decision-detail">{{ row.detail }}</span>
            <span class="lupin-decision-word" :data-tone="row.tone">{{ row.word }}</span>
          </li>
        </ul>
        <figcaption>{{ decision.footer }}</figcaption>
      </figure>
    </section>

    <section id="product" class="lupin-showcase" aria-labelledby="showcase-title">
      <div class="lupin-section-line">
        <h2 id="showcase-title">The evidence, in view.</h2>
        <a :href="withBase('/guide/concepts')"
          >Explore the product <span aria-hidden="true">→</span></a
        >
      </div>
      <div class="lupin-shots">
        <figure class="lupin-frame">
          <div class="lupin-frame-bar" aria-hidden="true">
            <span></span><span></span><span></span>
          </div>
          <img
            :src="runsPreview"
            alt="The Lupin runs view in the dark theme: run totals, a table of runs with their outcomes and test counts, release readiness and recent executions."
            width="1440"
            height="900"
            fetchpriority="high"
            decoding="async"
          />
          <figcaption>Every run, newest first, with what passed and what did not.</figcaption>
        </figure>
        <figure class="lupin-frame">
          <div class="lupin-frame-bar" aria-hidden="true">
            <span></span><span></span><span></span>
          </div>
          <img
            :src="runDetailPreview"
            alt="A failed run in Lupin: the headline “2 of 8 tests failed”, the run's phase timeline, totals, branch and commit, and its quality gate."
            width="1440"
            height="900"
            loading="lazy"
            decoding="async"
          />
          <figcaption>One run: the failures first, then the phases and the gate.</figcaption>
        </figure>
      </div>
      <p class="lupin-technical-note">Captured from the product with demonstration runs.</p>
    </section>

    <section id="how-it-works" class="lupin-section" aria-labelledby="how-title">
      <div class="lupin-section-heading">
        <p class="lupin-kicker">How it works</p>
        <h2 id="how-title">Observe. Investigate. Decide.</h2>
        <p>From the first test result to the release decision, the context travels with it.</p>
      </div>
      <ol class="lupin-steps">
        <li v-for="(stage, index) in stages" :key="stage.title">
          <span class="lupin-index">0{{ index + 1 }}</span>
          <h3>{{ stage.title }}</h3>
          <p>{{ stage.text }}</p>
          <a :href="withBase(stage.link)">{{ stage.action }} <span aria-hidden="true">→</span></a>
        </li>
      </ol>
    </section>

    <section class="lupin-section" aria-labelledby="capabilities-title">
      <div class="lupin-section-heading">
        <p class="lupin-kicker">What you get</p>
        <h2 id="capabilities-title">Built for the question before a release.</h2>
        <p>Is it broken, is it flaky, or is it just not measured yet?</p>
      </div>
      <div class="lupin-capabilities">
        <article v-for="(item, index) in capabilities" :key="item.title">
          <span class="lupin-index">0{{ index + 1 }}</span>
          <h3>
            <a :href="withBase(item.link)">{{ item.title }} <span aria-hidden="true">→</span></a>
          </h3>
          <p>{{ item.text }}</p>
        </article>
      </div>
    </section>

    <section class="lupin-section" aria-labelledby="integrations-title">
      <div class="lupin-section-heading">
        <p class="lupin-kicker">Works with your tools</p>
        <h2 id="integrations-title">Keep your test stack.</h2>
        <p>
          Stream results through the Playwright reporter, or import the reports you already write.
        </p>
      </div>
      <ul class="lupin-integrations">
        <li v-for="item in integrations" :key="item[0]">
          <strong>{{ item[0] }}</strong
          ><span>{{ item[1] }}</span>
        </li>
      </ul>
      <a class="lupin-text-link" :href="withBase('/guide/sending-results')"
        >Read the integration guide <span aria-hidden="true">→</span></a
      >
    </section>

    <section id="get-started" class="lupin-section" aria-labelledby="start-title">
      <div class="lupin-section-heading">
        <p class="lupin-kicker">Get started</p>
        <h2 id="start-title">Three commands to a gated pull request.</h2>
        <p>
          Download a <a :href="`${githubUrl}/releases`">release</a>, then run these from your
          machine and your CI.
        </p>
      </div>
      <ol class="lupin-quickstart">
        <li v-for="(step, index) in quickStart" :key="step.title">
          <span class="lupin-index">0{{ index + 1 }}</span>
          <div>
            <h3>
              <a :href="withBase(step.link)">{{ step.title }}</a>
            </h3>
            <pre><code>{{ step.command }}</code></pre>
            <p>{{ step.note }}</p>
          </div>
        </li>
      </ol>
    </section>

    <section class="lupin-section lupin-open" aria-labelledby="open-title">
      <div>
        <p class="lupin-kicker">Open source</p>
        <h2 id="open-title">Inspect the code.<br />Understand the decisions.</h2>
      </div>
      <div>
        <p>
          MIT licensed. The source, the issue tracker, and how this repository tests itself are all
          public.
        </p>
        <a class="lupin-text-link" :href="`${githubUrl}/blob/main/.github/CONTRIBUTING.md`"
          >Read the contributing guide <span aria-hidden="true">↗</span></a
        >
      </div>
    </section>

    <section class="lupin-closing" aria-labelledby="closing-title">
      <p class="lupin-kicker">Lupin<span class="lupin-wordmark-dot" aria-hidden="true">.</span></p>
      <h2 id="closing-title">Make quality a decision,<br />not a guess.</h2>
      <div class="lupin-actions">
        <a class="lupin-button primary" :href="withBase('/guide/install')"
          >Get started <span aria-hidden="true">→</span></a
        ><a class="lupin-button" :href="withBase('/guide/')">Read the docs</a>
      </div>
    </section>
  </main>
</template>
