"use client";

import {
  ArrowRight,
  BrainCircuit,
  CheckCircle2,
  CircleDashed,
  Compass,
  FlaskConical,
  Radar,
  Ruler,
} from 'lucide-react';
import { MRU_ASSUMPTIONS, MRU_LIMITATIONS } from '@/services/mruForecastService';

interface ModelsOverviewPanelProps {
  onGoToValidation?: () => void;
  onGoToLive?: () => void;
}

function FlowStep({
  index,
  icon: Icon,
  title,
  description,
  isLast = false,
}: {
  index: number;
  icon: typeof Compass;
  title: string;
  description: string;
  isLast?: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-3">
      <div className="flex min-w-0 flex-1 items-start gap-3 rounded-lg border border-slate-800 bg-slate-950/50 p-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-cyan-400/25 bg-cyan-400/10 text-cyan-200">
          <Icon className="h-4 w-4" aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <div className="font-mono text-[9px] uppercase tracking-widest text-slate-500">Step {index}</div>
          <div className="truncate text-sm font-medium text-slate-100">{title}</div>
          <div className="mt-0.5 text-xs leading-relaxed text-slate-400">{description}</div>
        </div>
      </div>
      {!isLast && <ArrowRight className="h-4 w-4 shrink-0 text-slate-600" aria-hidden="true" />}
    </div>
  );
}

export function ModelsOverviewPanel({ onGoToValidation, onGoToLive }: ModelsOverviewPanelProps) {
  return (
    <main className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pr-1">
      {/* What we are forecasting */}
      <section className="rounded-lg border border-slate-700/50 bg-slate-900/30 p-5 shadow-2xl backdrop-blur-xl">
        <div className="flex items-center gap-2">
          <Compass className="h-4 w-4 shrink-0 text-cyan-300" aria-hidden="true" />
          <h2 className="text-xs font-semibold uppercase tracking-widest text-slate-300">What we forecast</h2>
        </div>
        <p className="mt-3 max-w-3xl text-sm leading-relaxed text-slate-300">
          Spacecraft at the <span className="text-cyan-200">L1 point</span> sit ~1.5 million km sunward of Earth and see the
          solar wind <span className="text-cyan-200">before it arrives</span>. The goal is to predict how that solar wind —
          its speed, density and magnetic field — <span className="text-cyan-200">propagates from L1 to Earth</span>, giving
          us a head start before it hits the magnetosphere.
        </p>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
          <FlowStep index={1} icon={FlaskConical} title="Train on past events" description="Models learn from historical storms (done offline — no action needed here)." />
          <FlowStep index={2} icon={Ruler} title="Validate" description="Check predictions against what really reached Earth." />
          <FlowStep index={3} icon={Radar} title="Live forecast" description="Apply the models automatically to the current L1 feed." isLast />
        </div>
      </section>

      {/* Model cards */}
      <section className="grid gap-4 lg:grid-cols-2">
        {/* MRU baseline */}
        <article className="flex min-w-0 flex-col rounded-lg border border-cyan-400/30 bg-cyan-400/[0.06] p-5 shadow-2xl backdrop-blur-xl">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-cyan-400/30 bg-cyan-400/10 text-cyan-200">
                <Ruler className="h-5 w-5" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <h3 className="truncate text-base font-semibold text-slate-100">MRU baseline</h3>
                <div className="font-mono text-[10px] uppercase tracking-widest text-slate-500">Uniform rectilinear motion</div>
              </div>
            </div>
            <span className="inline-flex shrink-0 items-center gap-1.5 rounded border border-emerald-400/30 bg-emerald-400/10 px-2 py-1 font-mono text-[9px] uppercase tracking-widest text-emerald-200">
              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
              Active · no training
            </span>
          </div>

          <p className="mt-4 text-sm leading-relaxed text-slate-300">
            The simplest physical model: assume the solar wind travels in a straight line from L1 to Earth at the speed we
            measure at L1, carrying its properties unchanged. Only the <span className="text-cyan-200">arrival time</span> shifts.
          </p>

          <div className="mt-4 rounded-md border border-slate-800 bg-slate-950/60 p-3 text-center font-mono text-sm text-cyan-100">
            arrival lag = L1 distance ÷ solar-wind speed
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div>
              <div className="mb-1.5 font-mono text-[9px] uppercase tracking-widest text-emerald-300/80">Assumptions</div>
              <ul className="space-y-1.5 text-xs leading-relaxed text-slate-400">
                {MRU_ASSUMPTIONS.map(item => (
                  <li key={item} className="flex gap-1.5">
                    <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-emerald-400/60" aria-hidden="true" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <div className="mb-1.5 font-mono text-[9px] uppercase tracking-widest text-amber-300/80">Limitations</div>
              <ul className="space-y-1.5 text-xs leading-relaxed text-slate-400">
                {MRU_LIMITATIONS.map(item => (
                  <li key={item} className="flex gap-1.5">
                    <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-amber-400/60" aria-hidden="true" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="mt-auto flex flex-wrap gap-2 pt-4">
            {onGoToLive && (
              <button
                type="button"
                onClick={onGoToLive}
                className="inline-flex h-9 items-center gap-2 rounded-md border border-cyan-400/30 bg-cyan-400/10 px-3 text-xs text-cyan-100 transition hover:border-cyan-300/60 hover:bg-cyan-400/15"
              >
                <Radar className="h-3.5 w-3.5" aria-hidden="true" />
                See it live
              </button>
            )}
            {onGoToValidation && (
              <button
                type="button"
                onClick={onGoToValidation}
                className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-700 px-3 text-xs text-slate-300 transition hover:border-cyan-400/40 hover:text-cyan-100"
              >
                <Ruler className="h-3.5 w-3.5" aria-hidden="true" />
                Check accuracy
              </button>
            )}
          </div>
        </article>

        {/* ML model (planned) */}
        <article className="flex min-w-0 flex-col rounded-lg border border-slate-700/50 bg-slate-900/30 p-5 shadow-2xl backdrop-blur-xl">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-purple-400/25 bg-purple-400/10 text-purple-200">
                <BrainCircuit className="h-5 w-5" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <h3 className="truncate text-base font-semibold text-slate-100">ML model</h3>
                <div className="font-mono text-[10px] uppercase tracking-widest text-slate-500">Learned correction</div>
              </div>
            </div>
            <span className="inline-flex shrink-0 items-center gap-1.5 rounded border border-slate-700 bg-slate-800/60 px-2 py-1 font-mono text-[9px] uppercase tracking-widest text-slate-400">
              <CircleDashed className="h-3.5 w-3.5" aria-hidden="true" />
              Planned
            </span>
          </div>

          <p className="mt-4 text-sm leading-relaxed text-slate-300">
            A model trained on past events to learn the corrections the MRU baseline misses — how structures stretch, slow
            down or rotate on the way in. It is <span className="text-purple-200">trained once, offline</span>, then served
            automatically: no configuration, no buttons. The MRU baseline is always the yardstick it must beat.
          </p>

          <div className="mt-4 rounded-md border border-dashed border-slate-700 bg-slate-950/40 p-4 text-sm text-slate-500">
            Not trained yet. Once a model artifact exists, this card will show what it was trained on, when it was last
            updated, and its score against the MRU baseline.
          </div>
        </article>
      </section>
    </main>
  );
}
