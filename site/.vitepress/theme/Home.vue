<script setup lang="ts">
import { withBase } from 'vitepress';
import focusPreview from '../../../docs/assets/focus.png';
import insightsPreview from '../../../docs/assets/insights.png';
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
    title: 'Connect',
    text: 'Point it at your repo and CI. Two minutes.',
    link: '/guide/install',
    action: 'Install',
  },
  {
    title: 'Lupin watches',
    text: 'Every run, flaky test and health signal, as you ship.',
    link: '/guide/concepts',
    action: 'What it reads',
  },
  {
    title: 'You decide',
    text: 'One thing first. One click to retry or quarantine.',
    link: '/guide/quality-gates',
    action: 'Gates and quarantine',
  },
];

/** The three commands are the guides' own (install.md, cli.md); the quick start does not invent one. */
const quickStart = [
  {
    title: 'Start Lupin',
    command: './start.sh',
    note: 'Needs Docker. Windows: .\\start.cmd',
    link: '/guide/install',
  },
  {
    title: 'Send a test run',
    command:
      'lupin test --format playwright-json --report results.json -- npx playwright test --reporter=json',
    note: 'Wraps your test command and uploads the result.',
    link: '/guide/cli',
  },
  {
    title: 'Gate the pull request',
    command: 'lupin gate --branch "$BRANCH" --commit "$SHA" --pr 42',
    note: 'Fails CI when the gate fails.',
    link: '/guide/quality-gates',
  },
];
</script>

<template>
  <main class="lupin-home">
    <section class="lupin-hero" aria-labelledby="hero-title">
      <div class="lupin-hero-copy">
        <p class="lupin-kicker lupin-arrive">
          <span aria-hidden="true"></span> The QA copilot for AI-speed teams
        </p>
        <h1 id="hero-title" class="lupin-arrive">
          AI writes the code.<br /><span>Lupin keeps it shippable.</span>
        </h1>
        <p class="lupin-lead lupin-arrive">
          It reads every test run, spots what broke, and fixes the obvious in one click.
        </p>
        <div class="lupin-actions lupin-arrive">
          <a class="lupin-button primary" :href="withBase('/guide/install')"
            >Get started <span aria-hidden="true">→</span></a
          ><a class="lupin-button" :href="githubUrl" target="_blank" rel="noopener noreferrer"
            >View on GitHub <span aria-hidden="true">↗</span></a
          >
        </div>
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
      </figure>
    </section>

    <section id="product" class="lupin-showcase" aria-labelledby="showcase-title">
      <div class="lupin-section-line">
        <h2 id="showcase-title">It already knows what to show you.</h2>
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
            :src="focusPreview"
            alt="Lupin&rsquo;s home: a greeting, one failing test on main to fix first, and a one-click Retry now button."
            width="1440"
            height="900"
            fetchpriority="high"
            decoding="async"
          />
        </figure>
        <figure class="lupin-frame">
          <div class="lupin-frame-bar" aria-hidden="true">
            <span></span><span></span><span></span>
          </div>
          <img
            :src="insightsPreview"
            alt="Lupin Insights: release readiness, flaky tests ranked by flips, slowest tests and failures by suite and day."
            width="1440"
            height="900"
            loading="lazy"
            decoding="async"
          />
        </figure>
      </div>
    </section>

    <section id="how-it-works" class="lupin-section" aria-labelledby="how-title">
      <div class="lupin-section-heading">
        <p class="lupin-kicker">How it works</p>
        <h2 id="how-title">Connect. Forget it. Ship.</h2>
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

    <section id="get-started" class="lupin-section" aria-labelledby="start-title">
      <div class="lupin-section-heading">
        <p class="lupin-kicker">Get started</p>
        <h2 id="start-title">Three commands.</h2>
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

    <section class="lupin-closing" aria-labelledby="closing-title">
      <p class="lupin-kicker">Lupin<span class="lupin-wordmark-dot" aria-hidden="true">.</span></p>
      <h2 id="closing-title">Free. Forever.<br /><span>Open source, on your machines.</span></h2>
      <div class="lupin-actions">
        <a class="lupin-button primary" :href="withBase('/guide/install')"
          >Get started <span aria-hidden="true">→</span></a
        ><a class="lupin-button" :href="withBase('/guide/')">Read the docs</a>
      </div>
    </section>
  </main>
</template>
