/*
 * Copyright 2026 OwnRAG contributors — Apache-2.0.
 *
 * Copy for the product home page, kept in one place so the wording can be reviewed without reading
 * JSX. Every figure quoted here was measured in this repository (see engine/FREEZE-LEDGER.md);
 * nothing is invented.
 */
export interface LandingCopy {
  nav: { product: string; trust: string; api: string; faq: string; signIn: string; create: string };
  hero: {
    eyebrow: string;
    titleTop: string;
    titleAccent: string;
    titleBottom: string;
    lede: string;
    ctaPrimary: string;
    ctaSecondary: string;
    footnote: string;
  };
  ledger: {
    title: string;
    path: string;
    note: string;
    rows: { value: string; label: string; note: string }[];
  };
  featureGrid: { title: string; lede: string; items: { title: string; body: string }[] };
  screens: { title: string; lede: string; captions: Record<string, string> };
  pipeline: {
    label: string;
    title: string;
    lede: string;
    tabs: { key: string; label: string; headline: string; points: string[] }[];
  };
  compare: { label: string; title: string; oldTitle: string; ownTitle: string; old: string[]; own: string[] };
  guarantees: { title: string; body: string }[];
  faq: { label: string; title: string; items: { q: string; a: string }[] };
  closing: { title: string; body: string; primary: string; secondary: string };
  footer: { tagline: string; attribution: string };
}

export const COPY: LandingCopy = {
  nav: { product: 'Product', trust: 'Trust', api: 'API', faq: 'FAQ', signIn: 'Sign in', create: 'Create account' },
  hero: {
    eyebrow: 'OwnRAG · self-hosted retrieval',
    titleTop: 'Your data. Your models.',
    titleAccent: 'Your',
    titleBottom: 'RAG.',
    lede: 'Ingest documents, index them, and answer questions with citations you can open — on your own hardware, with your own model endpoints, and no dependency on anybody else’s cloud.',
    ctaPrimary: 'Create an account',
    ctaSecondary: 'See the console',
    footnote: 'Apache-2.0 · self-hosted · runs with no model configured at all',
  },
  ledger: {
    title: 'Frozen benchmark ledger',
    path: 'engine/FREEZE-LEDGER.md',
    note: 'Measured in this repository. Failures are published beside the results, including one verification recorded as unproven rather than bent until it passed.',
    rows: [
      { value: '43/46', label: 'English benchmark', note: 'frozen control 42/46' },
      { value: '33/34', label: 'Arabic benchmark', note: 'refusal axis reproduced exactly' },
      { value: '17 · 27 · 12', label: 'OCR, worker, guard tests', note: 'all passing' },
      { value: '13,920', label: 'stale index rows found', note: 'root-caused, fixed, purged' },
    ],
  },
  featureGrid: {
    title: 'Built to run where your documents already are.',
    lede: 'Four stages, each one auditable. A bad answer can be traced to the stage that produced it instead of being blamed on the model.',
    items: [
      { title: 'Native text first', body: 'PyMuPDF, python-docx and openpyxl read the text layer before any OCR is considered.' },
      { title: 'Hybrid retrieval', body: 'Lexical and vector candidates are merged, then reranked down to the passages the model actually reads.' },
      { title: 'Citations with provenance', body: 'Every passage keeps its document, page and bounding box, so a citation can be checked by hand.' },
      { title: 'Quarantine over corruption', body: 'A numeric field that fails validation is withheld from retrieval, with its reason recorded.' },
      { title: 'Local accounts', body: 'Email and password, scrypt-hashed, with sessions that expire and can be revoked individually.' },
      { title: 'Honest about models', body: 'With no model configured the pipeline answers extractively, and every answer says so.' },
    ],
  },
  screens: {
    title: 'This is the actual console.',
    lede: 'Not a mockup. Screenshots captured from the bundled sample corpus, so nothing in them is anyone’s real data.',
    captions: {
      overview: 'Corpus health, ingestion stages and what needs attention',
      knowledge: 'Knowledge bases, documents and chunking templates',
      retrieval: 'Threshold, weights and reranking against real queries',
      chat: 'Grounded answers with an openable citation inspector',
      models: 'Chat, embedding and rerank slots you point at your own endpoints',
    },
  },
  pipeline: {
    label: 'The pipeline',
    title: 'Four stages, each one auditable.',
    lede: 'Most retrieval stacks hide the seam where quality is lost. OwnRAG keeps ingest, retrieval, answering and operation as separate, measurable stages.',
    tabs: [
      {
        key: 'ingest',
        label: 'Ingest',
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
        headline: 'One deployment, one account database, no hosted dependency',
        points: [
          'Accounts are local: email and password, scrypt-hashed, with sessions that expire and revoke.',
          'Data sources are connectors — web crawls, S3, Slack, Gmail, SharePoint and more.',
          'Provider keys, budgets and model slots live in your own database, not in someone else’s cloud.',
          'The console is a client of the same HTTP API you can call from a script.',
        ],
      },
    ],
  },
  compare: {
    label: 'Trust',
    title: 'The differences that are decisions, not features.',
    oldTitle: 'The usual way',
    ownTitle: 'OwnRAG',
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
  },
  guarantees: [
    { title: 'Credentials that behave', body: 'scrypt hashing, constant-time comparison, session expiry, per-account lockout and an audit trail of sign-in events.' },
    { title: 'Unreadable is a state', body: 'A page that cannot be read says so. A number that fails validation is quarantined with its reason and withheld from retrieval.' },
    { title: 'Honest by construction', body: 'Extractive answers are labelled. A failed provider call invalidates a benchmark run instead of scoring it as a wrong answer.' },
  ],
  faq: {
    label: 'Questions',
    title: 'Answered plainly.',
    items: [
      { q: 'What is OwnRAG?', a: 'A self-hosted retrieval-augmented generation stack: an engine that parses, chunks, indexes and retrieves your documents, and a console that operates it. Both run on your infrastructure. The HTTP contract follows the established API shape, so existing clients keep working.' },
      { q: 'Where does my data actually go?', a: 'Nowhere. Parsing, OCR, indexing and retrieval run in the deployment. The only outbound calls are to the model endpoints you configure yourself, and with none configured the pipeline still answers — extractively, from your own text.' },
      { q: 'Which models does it support?', a: 'Chat, embedding and rerank slots are separate rows you point at any OpenAI-compatible endpoint, locally or remote. Without an embedding model the index is lexical, and the console says so rather than pretending otherwise.' },
      { q: 'How good is it, honestly?', a: 'On the frozen benchmarks in this repository: 43/46 on the English suite and 33/34 on Arabic, measured against a stored control with the run-to-run noise band recorded. Failures are published with the results, including one verification that could not be reproduced and is therefore recorded as unproven.' },
      { q: 'Does it work in Arabic?', a: 'Yes, and it is measured rather than asserted: 33/34 on the Arabic suite, with diacritics stripped and letter variants folded during tokenisation so الأجور and الاجور reach the same passage. Known limits — Arabic-Indic digits, dropped tashkeel and mixed-script numbers — are documented in engine/OCR-FREEZE.md instead of being hidden.' },
      { q: 'How do I start?', a: 'Create an account against your own engine, open the console, and ingest a folder. The engine has no hosted dependency, so the first document can be indexed before anything is configured at all.' },
    ],
  },
  closing: {
    title: 'Start with one folder of documents.',
    body: 'Create an account against your own engine and ingest something real. Nothing needs to be configured first, and nothing leaves the deployment.',
    primary: 'Create an account',
    secondary: 'Read the API',
  },
  footer: {
    tagline: 'OwnRAG — self-hosted retrieval. Apache-2.0.',
    attribution: 'Apache-2.0. See NOTICE and LICENSE for attribution.',
  },
};
