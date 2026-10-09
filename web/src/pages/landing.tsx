/*
 * Copyright 2026 OwnRAG contributors — Apache-2.0.
 *
 * Product home — the earlier text-led layout. NOT currently routed: `pages/home.tsx` renders the
 * product-first layout in `pages/landing-b.tsx` instead. Kept in the tree so the alternative is not
 * lost; delete it if the project is not going back to it.
 *
 * It is written in the console's own language (hairline depth, one accent, mono for figures) rather
 * than a separate marketing style, so the product and its front page look like the same thing. Every
 * figure quoted below was measured in this repository and is repeated from engine/FREEZE-LEDGER.md;
 * nothing here is invented.
 */
import {
  ArrowRight,
  BookOpen,
  Boxes,
  Check,
  Database,
  FileText,
  ScanText,
  Search,
  ServerCog,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';
import * as React from 'react';
import { Link } from 'react-router';
import { OwnRagMark, OwnRagWordmark } from '@/components/brand/logo';
import { Button } from '@/components/ui/button';

/* ------------------------------------------------------------------ content */

const CAPABILITIES = [
  {
    key: 'ingest',
    label: 'Ingest',
    icon: FileText,
    headline: 'PDFs, Office files and scans, parsed on your machine',
    points: [
      'PyMuPDF, python-docx and openpyxl read text natively first — OCR is never the first move.',
      'Scanned pages are recognised per region, with the page rectangle kept for citation.',
      'Numeric fields are validated structurally; a value that fails is quarantined, not indexed.',
      'Screenshots, byte-noise files and mixed PDFs each end in an explicit state, never a silent zero.',
    ],
  },
  {
    key: 'retrieve',
    label: 'Retrieve',
    icon: Search,
    headline: 'Hybrid search, then a reranker — the order matters',
    points: [
      'Lexical and vector candidates are merged, then cut to the passages the model actually reads.',
      'The reranker sees the whole candidate window; the candidate threshold is a default of 0, not 0.2.',
      'Widening the window and reranking was measured worth +4 on Arabic and kept its English result.',
      'Every passage keeps its document, page and provenance, so a citation can be checked by hand.',
    ],
  },
  {
    key: 'answer',
    label: 'Answer',
    icon: Sparkles,
    headline: 'Citations you can open, and honesty when a model is absent',
    points: [
      'Answers carry inline citation markers that resolve to the passage that produced them.',
      'With no model configured the pipeline is extractive, and every answer says so plainly.',
      'A provider that fails is reported as a provider failure — never scored as a wrong answer.',
      'Agents compose retrieval, tools and code into canvases you can version and re-run.',
    ],
  },
  {
    key: 'operate',
    label: 'Operate',
    icon: ServerCog,
    headline: 'One deployment, one account database, no hosted dependency',
    points: [
      'Accounts are local: email and password, scrypt-hashed, with sessions that expire and revoke.',
      'Data sources are connectors — web crawls, S3, Slack, Gmail, SharePoint and more.',
      'Provider keys, budgets and model slots live in your own database, not in someone else\u2019s cloud.',
      'The console is a client of the same HTTP API you can call from a script.',
    ],
  },
] as const;

const COMPARISON = {
  old: [
    'Every new model adds another provider account to manage',
    'Document text leaves the building to be parsed and embedded',
    'Citations point at a filename, not at a page',
    'A scanner that reads a number wrong is indistinguishable from a document containing it',
    'Retrieval quality is a feeling, not a number you can quote',
  ],
  own: [
    'One API, one account database, one set of limits — models are rows you configure',
    'Ingestion, indexing and retrieval all run inside the deployment',
    'Chunk provenance keeps the document, the page and the bounding box',
    'A number that cannot be validated is quarantined and withheld from retrieval',
    'Frozen benchmarks with controls, a measured noise band and recorded failures',
  ],
};

const PROOF = [
  { value: '43/46', label: 'English benchmark', note: 'frozen control 42/46' },
  { value: '33/34', label: 'Arabic benchmark', note: 'refusal axis reproduced exactly' },
  { value: '17 · 27 · 12', label: 'OCR, worker, guard tests', note: 'all passing' },
  { value: '13,920', label: 'stale index rows found', note: 'root-caused, fixed, purged' },
];

const FAQ = [
  {
    q: 'What is OwnRAG?',
    a: 'A self-hosted retrieval-augmented generation stack: an engine that parses, chunks, indexes and retrieves your documents, and a console that operates it. Both run on your infrastructure. The HTTP contract follows the established API shape, so existing clients keep working.',
  },
  {
    q: 'Where does my data actually go?',
    a: 'Nowhere. Parsing, OCR, indexing and retrieval run in the deployment. The only outbound calls are to the model endpoints you configure yourself, and with none configured the pipeline still answers — extractively, from your own text.',
  },
  {
    q: 'Which models does it support?',
    a: 'Chat, embedding and rerank slots are separate rows you point at any OpenAI-compatible endpoint, locally or remote. Without an embedding model the index is lexical, and the console says so rather than pretending otherwise.',
  },
  {
    q: 'How good is it, honestly?',
    a: 'On the frozen benchmarks in this repository: 43/46 on the English suite and 33/34 on Arabic, measured against a stored control with the run-to-run noise band recorded. Failures are published with the results, including one verification that could not be reproduced and is therefore recorded as unproven.',
  },
  {
    q: 'How do I start?',
    a: 'Create an account against your own engine, open the console, and ingest a folder. The engine has no hosted dependency, so the first document can be indexed before anything is configured at all.',
  },
];

/* ------------------------------------------------------------------ pieces */

function Nav() {
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-canvas/85 backdrop-blur-[2px]">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-6 px-5">
        <Link to="/" className="flex items-center gap-2">
          <OwnRagMark size={18} />
          <OwnRagWordmark size="sm" />
        </Link>
        <nav className="ml-4 hidden items-center gap-5 text-xs text-ink-2 md:flex">
          <a href="#capabilities" className="transition-colors duration-150 hover:text-ink">
            Product
          </a>
          <a href="#trust" className="transition-colors duration-150 hover:text-ink">
            Trust
          </a>
          <Link to="/developers" className="transition-colors duration-150 hover:text-ink">
            API
          </Link>
          <a href="#faq" className="transition-colors duration-150 hover:text-ink">
            FAQ
          </a>
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <Button asChild variant="ghost" size="sm">
            <Link to="/login">Sign in</Link>
          </Button>
          <Button asChild variant="primary" size="sm">
            <Link to="/signup">Create account</Link>
          </Button>
        </div>
      </div>
    </header>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-2xs font-medium uppercase tracking-[0.14em] text-ink-3">{children}</p>;
}

function Hero() {
  return (
    <section className="border-b border-line">
      <div className="mx-auto grid w-full max-w-6xl grid-cols-1 gap-10 px-5 py-16 lg:grid-cols-[1.35fr_1fr] lg:gap-14 lg:py-24">
        <div className="or-rise-in">
          <SectionLabel>OwnRAG &middot; self-hosted retrieval</SectionLabel>
          <h1 className="mt-5 text-4xl font-medium leading-[1.06] tracking-[-0.03em] text-ink sm:text-5xl lg:text-6xl">
            Your data. Your models.
            <br />
            <span className="text-accent">Your</span> RAG.
          </h1>
          <p className="mt-5 max-w-xl text-sm leading-relaxed text-ink-2">
            Ingest documents, index them, and answer questions with citations you can open — on your
            own hardware, with your own model endpoints, and no dependency on anybody else&rsquo;s cloud.
          </p>
          <div className="mt-7 flex flex-wrap items-center gap-3">
            <Button asChild variant="primary" size="md">
              <Link to="/signup">
                Create an account
                <ArrowRight className="ml-1.5 size-3.5" />
              </Link>
            </Button>
            <Button asChild variant="outline" size="md">
              <Link to="/login">Sign in</Link>
            </Button>
          </div>
          <p className="mt-4 text-2xs text-ink-3">
            Apache-2.0 &middot; self-hosted &middot; runs with no model configured at all
          </p>
        </div>

        {/* A real console fragment rather than an illustration: the claim is the numbers. */}
        <div className="or-fade-in self-center rounded-lg border border-line bg-surface-1">
          <div className="flex items-center justify-between border-b border-line px-3 py-2">
            <span className="text-2xs font-medium text-ink-2">Frozen benchmark ledger</span>
            <span className="font-mono text-2xs text-ink-3">engine/FREEZE-LEDGER.md</span>
          </div>
          <ul className="divide-y divide-line">
            {PROOF.map((item) => (
              <li key={item.label} className="flex items-baseline gap-3 px-3 py-2.5">
                <span className="w-24 shrink-0 font-mono text-md text-ink">{item.value}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs text-ink-2">{item.label}</span>
                  <span className="block truncate text-2xs text-ink-3">{item.note}</span>
                </span>
              </li>
            ))}
          </ul>
          <div className="border-t border-line px-3 py-2">
            <p className="text-2xs leading-relaxed text-ink-3">
              Measured in this repository. Failures are published beside the results, including one
              verification recorded as unproven rather than bent until it passed.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

function Capabilities() {
  const [active, setActive] = React.useState<(typeof CAPABILITIES)[number]['key']>('ingest');
  const current = CAPABILITIES.find((item) => item.key === active) ?? CAPABILITIES[0];

  return (
    <section id="capabilities" className="border-b border-line">
      <div className="mx-auto w-full max-w-6xl px-5 py-16 lg:py-20">
        <div className="max-w-2xl">
          <SectionLabel>The pipeline</SectionLabel>
          <h2 className="mt-4 text-2xl font-medium tracking-[-0.02em] text-ink sm:text-3xl">
            Four stages, each one auditable.
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-ink-2">
            Most retrieval stacks hide the seam where quality is lost. OwnRAG keeps ingest, retrieval,
            answering and operation as separate, measurable stages — so a bad answer can be traced to
            the stage that produced it instead of being blamed on the model.
          </p>
        </div>

        <div className="mt-9 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,15rem)_1fr]">
          <div role="tablist" aria-label="Pipeline stages" className="flex gap-1.5 overflow-x-auto lg:flex-col lg:overflow-visible">
            {CAPABILITIES.map((item) => {
              const Icon = item.icon;
              const selected = item.key === active;
              return (
                <button
                  key={item.key}
                  role="tab"
                  aria-selected={selected}
                  onClick={() => setActive(item.key)}
                  className={
                    'flex shrink-0 items-center gap-2 rounded-md border px-3 py-2 text-left text-xs transition-colors duration-150 ' +
                    (selected
                      ? 'border-line-accent bg-accent-soft text-ink'
                      : 'border-line bg-surface-1 text-ink-2 hover:border-line-strong hover:text-ink')
                  }
                >
                  <Icon className={'size-3.5 ' + (selected ? 'text-accent' : 'text-ink-3')} />
                  {item.label}
                </button>
              );
            })}
          </div>

          <div className="rounded-lg border border-line bg-surface-1 p-5">
            <h3 className="text-md font-medium tracking-[-0.015em] text-ink">{current.headline}</h3>
            <ul className="mt-4 space-y-2.5">
              {current.points.map((point) => (
                <li key={point} className="flex items-start gap-2.5 text-xs leading-relaxed text-ink-2">
                  <Check className="mt-0.5 size-3.5 shrink-0 text-accent" />
                  <span>{point}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}

function Trust() {
  return (
    <section id="trust" className="border-b border-line">
      <div className="mx-auto w-full max-w-6xl px-5 py-16 lg:py-20">
        <div className="max-w-2xl">
          <SectionLabel>Trust</SectionLabel>
          <h2 className="mt-4 text-2xl font-medium tracking-[-0.02em] text-ink sm:text-3xl">
            The differences that are decisions, not features.
          </h2>
        </div>

        <div className="mt-9 grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-line bg-line md:grid-cols-2">
          <div className="bg-surface-1 p-5">
            <p className="text-2xs font-medium uppercase tracking-[0.14em] text-ink-3">The usual way</p>
            <ul className="mt-4 space-y-3">
              {COMPARISON.old.map((line) => (
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
              OwnRAG
            </p>
            <ul className="mt-4 space-y-3">
              {COMPARISON.own.map((line) => (
                <li key={line} className="flex items-start gap-2.5 text-xs leading-relaxed text-ink">
                  <Check className="mt-0.5 size-3.5 shrink-0 text-accent" />
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3">
          {[
            {
              icon: ShieldCheck,
              title: 'Credentials that behave',
              body: 'scrypt hashing, constant-time comparison, session expiry, per-account lockout and an audit trail of sign-in events.',
            },
            {
              icon: ScanText,
              title: 'Unreadable is a state',
              body: 'A page that cannot be read says so. A number that fails validation is quarantined with its reason and withheld from retrieval.',
            },
            {
              icon: Boxes,
              title: 'Honest by construction',
              body: 'Extractive answers are labelled. A failed provider call invalidates a benchmark run instead of scoring it as a wrong answer.',
            },
          ].map((item) => {
            const Icon = item.icon;
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
  return (
    <section id="faq" className="border-b border-line">
      <div className="mx-auto grid w-full max-w-6xl grid-cols-1 gap-8 px-5 py-16 lg:grid-cols-[minmax(0,16rem)_1fr] lg:py-20">
        <div>
          <SectionLabel>Questions</SectionLabel>
          <h2 className="mt-4 text-2xl font-medium tracking-[-0.02em] text-ink">Answered plainly.</h2>
        </div>
        <div className="divide-y divide-line border-t border-line">
          {FAQ.map((item) => (
            <details key={item.q} className="group py-4">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm text-ink marker:hidden">
                {item.q}
                <span className="font-mono text-2xs text-ink-3 transition-transform duration-150 group-open:rotate-90">
                  &gt;
                </span>
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
  return (
    <section className="border-b border-line">
      <div className="mx-auto flex w-full max-w-6xl flex-col items-start gap-6 px-5 py-14 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-xl font-medium tracking-[-0.02em] text-ink">
            Start with one folder of documents.
          </h2>
          <p className="mt-2 max-w-xl text-xs leading-relaxed text-ink-2">
            Create an account against your own engine and ingest something real. Nothing needs to be
            configured first, and nothing leaves the deployment.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button asChild variant="primary" size="md">
            <Link to="/signup">
              Create an account
              <ArrowRight className="ml-1.5 size-3.5" />
            </Link>
          </Button>
          <Button asChild variant="outline" size="md">
            <Link to="/developers">
              <BookOpen className="mr-1.5 size-3.5" />
              Read the API
            </Link>
          </Button>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="mx-auto w-full max-w-6xl px-5 py-8">
      <div className="flex flex-col gap-4 text-2xs text-ink-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Database className="size-3" />
          <span>OwnRAG — self-hosted retrieval. Apache-2.0.</span>
        </div>
        <p className="max-w-xl leading-relaxed">
          Apache-2.0. See NOTICE and LICENSE for attribution.
        </p>
      </div>
    </footer>
  );
}

export default function LandingPage() {
  return (
    <div className="min-h-full bg-canvas">
      <Nav />
      <main>
        <Hero />
        <Capabilities />
        <Trust />
        <Faq />
        <Closing />
      </main>
      <Footer />
    </div>
  );
}
