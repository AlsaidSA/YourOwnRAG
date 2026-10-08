/*
 * Copyright 2026 OwnRAG contributors — Apache-2.0.
 * Data visualisation primitives, hand-rolled as SVG.
 *
 * Deliberate choice: no charting dependency. Every chart in OwnRAG is a small single-purpose
 * SVG that reads from real numbers, which keeps the bundle lean and — more importantly —
 * keeps the console from rendering decorative "dashboard filler". If a panel has no data,
 * it renders an empty state, not a fake curve.
 */
import * as React from 'react';
import { cn } from '@/lib/utils';

/** Sparkline — a trend line with a soft area fill, no axes. */
export function Sparkline({
  data,
  width = 96,
  height = 28,
  tone = 'accent',
  className,
  showLast,
}: {
  data: number[];
  width?: number;
  height?: number;
  tone?: 'accent' | 'violet' | 'ok' | 'warn' | 'danger';
  className?: string;
  showLast?: boolean;
}) {
  if (!data.length) return null;
  const stroke: Record<string, string> = {
    accent: 'var(--or-accent)',
    violet: 'var(--or-violet)',
    ok: 'var(--or-ok)',
    warn: 'var(--or-warn)',
    danger: 'var(--or-danger)',
  };
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const stepX = width / Math.max(1, data.length - 1);
  const points = data.map((value, index) => {
    const x = index * stepX;
    const y = height - ((value - min) / span) * (height - 4) - 2;
    return [x, y] as const;
  });
  const line = points.map(([x, y], index) => `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = `${line} L${width},${height} L0,${height} Z`;
  const last = points[points.length - 1];

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={className} aria-hidden>
      <path d={area} fill={stroke[tone]} opacity="0.1" />
      <path d={line} fill="none" stroke={stroke[tone]} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      {showLast && <circle cx={last[0]} cy={last[1]} r="2" fill={stroke[tone]} />}
    </svg>
  );
}

/** Grouped bar series for ingestion vs query volume. Two series, hairline baseline. */
export function BarSeries({
  data,
  height = 96,
  className,
}: {
  data: Array<{ label: string; ingest: number; query: number }>;
  height?: number;
  className?: string;
}) {
  if (!data.length) return null;
  const max = Math.max(...data.flatMap((d) => [d.ingest, d.query])) || 1;
  return (
    <div className={cn('flex items-end gap-2', className)} style={{ height }}>
      {data.map((row) => (
        <div key={row.label} className="flex h-full min-w-0 flex-1 flex-col justify-end gap-1">
          <div className="flex h-full items-end gap-0.5">
            <div
              className="w-full rounded-t-[3px] bg-accent/80 transition-[height] duration-[240ms]"
              style={{ height: `${(row.ingest / max) * 100}%` }}
              title={`Ingest ${row.ingest.toLocaleString()}`}
            />
            <div
              className="w-full rounded-t-[3px] bg-violet/60 transition-[height] duration-[240ms]"
              style={{ height: `${(row.query / max) * 100}%` }}
              title={`Queries ${row.query.toLocaleString()}`}
            />
          </div>
          <span className="text-center font-mono text-[10px] text-ink-3">{row.label}</span>
        </div>
      ))}
    </div>
  );
}

/** Horizontal ranked bar used for retrieval scores and stage distributions. */
export function MeterBar({
  value,
  max = 1,
  tone = 'accent',
  className,
  height = 4,
}: {
  value: number;
  max?: number;
  tone?: 'accent' | 'violet' | 'ok' | 'warn' | 'danger' | 'info';
  className?: string;
  height?: number;
}) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  const tones: Record<string, string> = {
    accent: 'bg-accent',
    violet: 'bg-violet',
    ok: 'bg-ok',
    warn: 'bg-warn',
    danger: 'bg-danger',
    info: 'bg-info',
  };
  return (
    <div
      className={cn('w-full overflow-hidden rounded-full bg-surface-2', className)}
      style={{ height }}
      role="presentation"
    >
      <div className={cn('h-full rounded-full transition-[width] duration-[240ms]', tones[tone])} style={{ width: `${pct}%` }} />
    </div>
  );
}

/** Stacked composition bar — pipeline stages, storage mix, document status split. */
export function StackedBar({
  segments,
  height = 6,
  className,
}: {
  segments: Array<{ value: number; tone: 'accent' | 'violet' | 'ok' | 'warn' | 'danger' | 'info' | 'muted'; label?: string }>;
  height?: number;
  className?: string;
}) {
  const total = segments.reduce((sum, s) => sum + s.value, 0) || 1;
  const tones: Record<string, string> = {
    accent: 'bg-accent',
    violet: 'bg-violet',
    ok: 'bg-ok',
    warn: 'bg-warn',
    danger: 'bg-danger',
    info: 'bg-info',
    muted: 'bg-line-strong',
  };
  return (
    <div className={cn('flex w-full gap-px overflow-hidden rounded-full', className)} style={{ height }}>
      {segments
        .filter((s) => s.value > 0)
        .map((segment, index) => (
          <div
            key={index}
            className={cn('h-full', tones[segment.tone])}
            style={{ width: `${(segment.value / total) * 100}%` }}
            title={segment.label}
          />
        ))}
    </div>
  );
}

/** Radial gauge for an aggregate score (recall, hit-rate, coverage). */
export function Gauge({
  value,
  size = 72,
  label,
  sublabel,
}: {
  value: number;
  size?: number;
  label?: string;
  sublabel?: string;
}) {
  const radius = (size - 8) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(1, value));
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--or-surface-2)" strokeWidth="4" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--or-accent)"
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - clamped)}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-mono text-sm text-ink">{(clamped * 100).toFixed(0)}%</span>
        {label && <span className="text-[10px] text-ink-3">{label}</span>}
        {sublabel && <span className="text-[10px] text-ink-3">{sublabel}</span>}
      </div>
    </div>
  );
}

/** Horizontal histogram used for score distributions in the retrieval console. */
export function Histogram({
  buckets,
  height = 40,
}: {
  buckets: Array<{ label: string; count: number }>;
  height?: number;
}) {
  const max = Math.max(...buckets.map((b) => b.count)) || 1;
  return (
    <div className="flex items-end gap-1" style={{ height }}>
      {buckets.map((bucket) => (
        <div key={bucket.label} className="flex h-full flex-1 flex-col justify-end">
          <div className="w-full rounded-t-[2px] bg-accent/70" style={{ height: `${(bucket.count / max) * 100}%` }} title={`${bucket.label}: ${bucket.count}`} />
        </div>
      ))}
    </div>
  );
}
