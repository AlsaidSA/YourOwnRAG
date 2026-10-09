/*
 * Copyright 2026 OwnRAG contributors — Apache-2.0.
 *
 * The product home page: product-first. A real capture of the console sits in the fold, a captioned
 * gallery of five screens carries the product claims, and the measured numbers sit underneath. Same
 * tokens and brand marks as the console, no decorative illustration, and no invented figures — the
 * copy in `landing-copy.ts` quotes only measurements from this repository.
 *
 * The layout uses a wide shell (100rem) so the page fills a large display instead of sitting in a
 * narrow column with dead gutters; body copy stays constrained for a readable measure.
 */
import {
  ArrowRight,
  BookOpen,
  Check,
  ChevronDown,
  Database,
  FileSearch,
  Globe,
  KeyRound,
  Layers,
  ScanText,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';
import * as React from 'react';
import { Link } from 'react-router';
import { OwnRagMark, OwnRagWordmark } from '@/components/brand/logo';
import { Button } from '@/components/ui/button';
import { COPY } from '@/pages/landing-copy';

const SCREEN_ORDER = ['overview', 'knowledge', 'retrieval', 'chat', 'models'] as const;

const FEATURE_ICONS = [FileSearch, Layers, ScanText, ShieldCheck, KeyRound, Sparkles] as const;

function Nav() {
  const copy = COPY;
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-canvas/85 backdrop-blur-[2px]">
      <div className="mx-auto flex h-14 w-full max-w-[100rem] items-center gap-4 px-5 sm:px-8 lg:px-12">
        <Link to="/" className="flex items-center gap-2">
          <OwnRagMark size={18} />
          <OwnRagWordmark size="sm" />
        </Link>
        <nav className="ms-2 hidden items-center gap-5 text-xs text-ink-2 md:flex">
          <a href="#product" className="transition-colors duration-150 hover:text-ink">
            {copy.nav.product}
          </a>
          <a href="#trust" className="transition-colors duration-150 hover:text-ink">
            {copy.nav.trust}
          </a>
          <Link to="/developers" className="transition-colors duration-150 hover:text-ink">
            {copy.nav.api}
          </Link>
          <a href="#faq" className="transition-colors duration-150 hover:text-ink">
            {copy.nav.faq}
          </a>
        </nav>
        <div className="ms-auto flex items-center gap-2">
          <Button asChild variant="ghost" size="sm">
            <Link to="/login">{copy.nav.signIn}</Link>
          </Button>
          <Button asChild variant="primary" size="sm">
            <Link to="/signup">{copy.nav.create}</Link>
          </Button>
        </div>
      </div>
    </header>
  );
}

function Hero() {
  const copy = COPY;
  return (
    <section className="border-b border-line">
      <div className="mx-auto w-full max-w-[100rem] px-5 pb-12 pt-16 sm:px-8 lg:px-12 lg:pt-20">
        <div className="mx-auto max-w-3xl text-center">
          <p className="text-2xs font-medium uppercase tracking-[0.14em] text-ink-3">{copy.hero.eyebrow}</p>
          <h1 className="mt-5 text-4xl font-medium leading-[1.08] tracking-[-0.03em] text-ink sm:text-5xl lg:text-[3.4rem]">
            {copy.hero.titleTop}
            <br />
            <span className="text-accent">{copy.hero.titleAccent}</span> {copy.hero.titleBottom}
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-sm leading-relaxed text-ink-2">{copy.hero.lede}</p>
          <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
            <Button asChild variant="primary" size="md">
              <Link to="/signup">
                {copy.hero.ctaPrimary}
                <ArrowRight className="ms-1.5 size-3.5" />
              </Link>
            </Button>
            <Button asChild variant="outline" size="md">
              <Link to="/login">{copy.hero.ctaSecondary}</Link>
            </Button>
          </div>
          <p className="mt-4 text-2xs text-ink-3">{copy.hero.footnote}</p>
        </div>

        {/* The product, in the fold: a real capture of the console on its sample corpus. */}
        <figure className="or-rise-in mt-10 overflow-hidden rounded-xl border border-line bg-surface-1 shadow-e2">
          <div className="flex items-center gap-2 border-b border-line px-3 py-2">
            <span className="flex gap-1.5">
              <span className="size-2 rounded-full bg-surface-3" />
              <span className="size-2 rounded-full bg-surface-3" />
              <span className="size-2 rounded-full bg-surface-3" />
            </span>
            <span className="ms-2 font-mono text-2xs text-ink-3">ownrag · overview</span>
            <span className="ms-auto rounded-sm border border-line px-1.5 py-0.5 font-mono text-2xs text-ink-3">
              /overview
            </span>
          </div>
          <img
            src="/screenshots/overview.webp"
            width={2880}
            height={1800}
            loading="eager"
            alt={copy.screens.captions.overview}
            className="block w-full"
          />
        </figure>

        {/* The numbers, straight under the product. */}
        <ul className="mt-8 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line lg:grid-cols-4">
          {copy.ledger.rows.map((row) => (
            <li key={row.label} className="bg-surface-1 px-4 py-3.5">
              <p className="font-mono text-lg leading-none text-ink">{row.value}</p>
              <p className="mt-2 text-xs text-ink-2">{row.label}</p>
              <p className="mt-0.5 text-2xs text-ink-3">{row.note}</p>
            </li>
          ))}
        </ul>
        <p className="mt-3 font-mono text-2xs text-ink-3">
          {copy.ledger.path} — {copy.ledger.note}
        </p>
      </div>
    </section>
  );
}

function Screens() {
  const copy = COPY;
  const [active, setActive] = React.useState<(typeof SCREEN_ORDER)[number]>('knowledge');
  return (
    <section className="border-b border-line" id="product">
      <div className="mx-auto w-full max-w-[100rem] px-5 py-16 sm:px-8 lg:px-12 lg:py-20">
        <div className="max-w-2xl">
          <p className="text-2xs font-medium uppercase tracking-[0.14em] text-ink-3">{copy.nav.product}</p>
          <h2 className="mt-4 text-2xl font-medium tracking-[-0.02em] text-ink sm:text-3xl">{copy.screens.title}</h2>
          <p className="mt-3 text-sm leading-relaxed text-ink-2">{copy.screens.lede}</p>
        </div>

        <div className="mt-9 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,17rem)_1fr]">
          <div
            role="tablist"
            aria-label={copy.screens.title}
            className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-1"
          >
            {SCREEN_ORDER.map((key) => {
              const selected = key === active;
              return (
                <button
                  key={key}
                  role="tab"
                  aria-selected={selected}
                  aria-controls="screen-panel"
                  onClick={() => setActive(key)}
                  className={
                    'overflow-hidden rounded-md border text-start transition-colors duration-150 ' +
                    (selected ? 'border-line-accent bg-accent-soft' : 'border-line bg-surface-1 hover:border-line-strong')
                  }
                >
                  <img
                    src={`/screenshots/${key}.webp`}
                    alt=""
                    width={2880}
                    height={1800}
                    loading="lazy"
                    className={'block w-full border-b border-line ' + (selected ? '' : 'opacity-60')}
                  />
                  <span className="block px-2.5 py-1.5">
                    <span className="block font-mono text-2xs text-ink-3">/{key}</span>
                    <span className={'mt-0.5 block text-2xs leading-snug ' + (selected ? 'text-ink' : 'text-ink-2')}>
                      {copy.screens.captions[key]}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

          <figure id="screen-panel" className="overflow-hidden rounded-lg border border-line bg-surface-1">
            <img
              key={active}
              src={`/screenshots/${active}.webp`}
              width={2880}
              height={1800}
              loading="lazy"
              alt={copy.screens.captions[active]}
              className="or-fade-in block w-full"
            />
            <figcaption className="border-t border-line px-3 py-2 text-2xs text-ink-3">
              {copy.screens.captions[active]}
            </figcaption>
          </figure>
        </div>
      </div>
    </section>
  );
}

function FeatureGrid() {
  const copy = COPY;
  return (
    <section className="border-b border-line">
      <div className="mx-auto w-full max-w-[100rem] px-5 py-16 sm:px-8 lg:px-12 lg:py-20">
        <div className="max-w-2xl">
          <p className="text-2xs font-medium uppercase tracking-[0.14em] text-ink-3">{copy.pipeline.label}</p>
          <h2 className="mt-4 text-2xl font-medium tracking-[-0.02em] text-ink sm:text-3xl">{copy.featureGrid.title}</h2>
          <p className="mt-3 text-sm leading-relaxed text-ink-2">{copy.featureGrid.lede}</p>
        </div>
        <div className="mt-9 grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-line bg-line md:grid-cols-2 lg:grid-cols-3">
          {copy.featureGrid.items.map((item, index) => {
            const Icon = FEATURE_ICONS[index] ?? Sparkles;
            return (
              <div key={item.title} className="bg-surface-1 p-5">
                <Icon className="size-4 text-accent" />
                <h3 className="mt-3 text-sm font-medium text-ink">{item.title}</h3>
                <p className="mt-1.5 text-xs leading-relaxed text-ink-2">{item.body}</p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function Compare() {
  const copy = COPY;
  return (
    <section id="trust" className="border-b border-line">
      <div className="mx-auto w-full max-w-[100rem] px-5 py-16 sm:px-8 lg:px-12 lg:py-20">
        <div className="max-w-2xl">
          <p className="text-2xs font-medium uppercase tracking-[0.14em] text-ink-3">{copy.compare.label}</p>
          <h2 className="mt-4 text-2xl font-medium tracking-[-0.02em] text-ink sm:text-3xl">{copy.compare.title}</h2>
        </div>
        <div className="mt-9 grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-line bg-line md:grid-cols-2">
          <div className="bg-surface-1 p-5">
            <p className="text-2xs font-medium uppercase tracking-[0.14em] text-ink-3">{copy.compare.oldTitle}</p>
            <ul className="mt-4 space-y-3">
              {copy.compare.old.map((line) => (
                <li key={line} className="flex items-start gap-2.5 text-xs leading-relaxed text-ink-3">
                  <X className="mt-0.5 size-3.5 shrink-0 text-ink-3" />
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="bg-surface-2 p-5">
            <p className="flex items-center gap-2 text-2xs font-medium uppercase tracking-[0.14em] text-accent">
              <OwnRagMark size={12} />
              {copy.compare.ownTitle}
            </p>
            <ul className="mt-4 space-y-3">
              {copy.compare.own.map((line) => (
                <li key={line} className="flex items-start gap-2.5 text-xs leading-relaxed text-ink">
                  <Check className="mt-0.5 size-3.5 shrink-0 text-accent" />
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3">
          {copy.guarantees.map((item, index) => {
            const Icon = [ShieldCheck, ScanText, Globe][index] ?? ShieldCheck;
            return (
              <div key={item.title} className="rounded-lg border border-line bg-surface-1 p-4">
                <Icon className="size-4 text-accent" />
                <h3 className="mt-3 text-sm font-medium text-ink">{item.title}</h3>
                <p className="mt-1.5 text-xs leading-relaxed text-ink-2">{item.body}</p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function Faq() {
  const copy = COPY;
  return (
    <section id="faq" className="border-b border-line">
      <div className="mx-auto grid w-full max-w-[100rem] grid-cols-1 gap-8 px-5 py-16 sm:px-8 lg:grid-cols-[minmax(0,16rem)_1fr] lg:px-12 lg:py-20">
        <div>
          <p className="text-2xs font-medium uppercase tracking-[0.14em] text-ink-3">{copy.faq.label}</p>
          <h2 className="mt-4 text-2xl font-medium tracking-[-0.02em] text-ink">{copy.faq.title}</h2>
        </div>
        <div className="divide-y divide-line border-t border-line">
          {copy.faq.items.map((item, index) => (
            <details key={item.q} className="group py-4" open={index === 0}>
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm text-ink marker:hidden">
                {item.q}
                <ChevronDown className="size-3.5 shrink-0 text-ink-3 transition-transform duration-150 group-open:rotate-180" />
              </summary>
              <p className="mt-3 max-w-3xl text-xs leading-relaxed text-ink-2">{item.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

function Closing() {
  const copy = COPY;
  return (
    <section className="border-b border-line">
      <div className="mx-auto flex w-full max-w-[100rem] flex-col items-start gap-6 px-5 py-14 sm:px-8 lg:flex-row lg:items-center lg:justify-between lg:px-12">
        <div>
          <h2 className="text-xl font-medium tracking-[-0.02em] text-ink">{copy.closing.title}</h2>
          <p className="mt-2 max-w-xl text-xs leading-relaxed text-ink-2">{copy.closing.body}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button asChild variant="primary" size="md">
            <Link to="/signup">
              {copy.closing.primary}
              <ArrowRight className="ms-1.5 size-3.5" />
            </Link>
          </Button>
          <Button asChild variant="outline" size="md">
            <Link to="/developers">
              <BookOpen className="me-1.5 size-3.5" />
              {copy.closing.secondary}
            </Link>
          </Button>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  const copy = COPY;
  return (
    <footer className="mx-auto w-full max-w-[100rem] px-5 py-8 sm:px-8 lg:px-12">
      <div className="flex flex-col gap-4 text-2xs text-ink-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Database className="size-3" />
          <span>{copy.footer.tagline}</span>
        </div>
        <p className="max-w-xl leading-relaxed">{copy.footer.attribution}</p>
      </div>
    </footer>
  );
}

export default function Landing() {
  return (
    <div className="min-h-full bg-canvas">
      <Nav />
      <main>
        <Hero />
        <Screens />
        <FeatureGrid />
        <Compare />
        <Faq />
        <Closing />
      </main>
      <Footer />
    </div>
  );
}
