"use client";

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  Archive,
  ArrowLeft,
  CalendarRange,
  Check,
  Clock3,
  Database,
  ExternalLink,
  FlaskConical,
  Gauge,
  Globe2,
  Info,
  Layers3,
  ListFilter,
  RefreshCw,
  RadioTower,
  Satellite,
  Sigma,
  Waves,
  X,
} from 'lucide-react';
import {
  CartesianGrid,
  Line,
  LineChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { PlaygroundTelemetryData } from '@/services/playgroundTelemetryService';
import type {
  SpacecraftConnectionStatus,
  SpacecraftId,
  SpacecraftTelemetry,
} from '@/services/spacecraftTelemetryService';
import {
  L1_PUBLIC_SOURCES,
  NEAR_EARTH_PUBLIC_SOURCES,
  type PublicDataReadiness,
  type PublicSpaceWeatherSource,
} from '@/services/spaceWeatherSourceCatalog';
import { PipelineHealthPanel } from './PipelineHealthPanel';
import type { PipelineHealthSnapshot } from '@/services/pipelineHealthService';
import { DataQualityPanel } from './DataQualityPanel';
import type { DataQualitySnapshot } from '@/services/dataQualityService';
import { UnivariateEdaPanel } from './UnivariateEdaPanel';
import type { EdaStratum, UnivariateEdaSnapshot } from '@/services/univariateEdaService';
import { L1EarthCouplingPanel } from './L1EarthCouplingPanel';
import type { L1EarthCouplingSnapshot } from '@/services/l1EarthCouplingService';
import { FeatureWorkbenchPanel } from './FeatureWorkbenchPanel';
import type { FeatureWorkbenchSnapshot } from '@/services/featureEngineeringService';
import { BaselinesLabPanel } from './BaselinesLabPanel';
import type { BaselinesLabSnapshot } from '@/services/modelBenchmarkService';
import { SequenceModelsPanel } from './SequenceModelsPanel';
import type { SequenceModelsSnapshot } from '@/services/sequenceModelService';
import { StormBrowserPanel } from './StormBrowserPanel';
import type { StormBrowserSnapshot } from '@/services/stormEventService';
import { LiveForecastPanel } from './LiveForecastPanel';
import type { LiveForecastSnapshot } from '@/services/liveForecastService';

type ChartSourceRow = {
  time_tag: string;
  value: string | number | null;
};

type ChartDefinition = {
  id: string;
  spacecraftId: SpacecraftId;
  spacecraftName: string;
  source: string;
  title: string;
  unit: string;
  dataKey: 'value';
  color: string;
  data: ChartSourceRow[];
  status: SpacecraftConnectionStatus;
  lastSampleTime: string | null;
};

type PlotTimeZone = 'UTC' | 'CEST';
type PlaygroundTab = 'insitu' | 'historic' | 'pipeline' | 'quality' | 'eda' | 'coupling' | 'features' | 'baselines' | 'sequence' | 'storms' | 'live';

interface PlaygroundDashboardProps extends PlaygroundTelemetryData {
  adminEmail: string | null;
}

const L1_TO_EARTH_DISTANCE_KM = 1_500_000;
const TELEMETRY_POLL_INTERVAL_MS = 30_000;
const PIPELINE_HEALTH_POLL_INTERVAL_MS = 60_000;
const PLOT_TIME_ZONE_CONFIG: Record<PlotTimeZone, { label: string; timeZone: string }> = {
  UTC: { label: 'UTC', timeZone: 'UTC' },
  CEST: { label: 'CEST', timeZone: 'Europe/Madrid' },
};
const PLAYGROUND_TABS: Array<{ id: PlaygroundTab; label: string; description: string }> = [
  { id: 'insitu', label: 'In situ data', description: 'Current L1 and near-Earth feeds' },
  { id: 'historic', label: 'Historic data', description: 'Event windows and validation sets' },
  { id: 'pipeline', label: 'Pipeline Health', description: 'Ingestion status and pull logs' },
  { id: 'quality', label: 'Data Quality', description: 'Coverage, gaps, outliers, cadence' },
  { id: 'eda', label: 'Univariate EDA', description: 'Distribution, stationarity, ACF' },
  { id: 'coupling', label: 'L1-Earth Coupling', description: 'CCF, lag, MI, coherence' },
  { id: 'features', label: 'Feature Workbench', description: 'Causal model matrix' },
  { id: 'baselines', label: 'Baselines Lab', description: 'Naive, linear, VAR, boosting' },
  { id: 'sequence', label: 'Sequence Models', description: 'LSTM, TCN, transformers' },
  { id: 'storms', label: 'Storm Browser', description: 'Event catalog and holdout' },
  { id: 'live', label: 'Live Forecast', description: 'Operational prediction loop' },
];

function getDefaultHistoricRange() {
  const stop = new Date();
  const start = new Date(stop.getTime() - 7 * 24 * 60 * 60 * 1000);

  return {
    start: start.toISOString().slice(0, 16),
    stop: stop.toISOString().slice(0, 16),
  };
}

function datetimeLocalToUtcIso(value: string) {
  const normalizedValue = value.length === 16 ? `${value}:00Z` : `${value}Z`;
  const parsed = new Date(normalizedValue);

  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function parseMetric(value: string | number | null | undefined) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  if (!value) {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function getMadridTimeZoneLabel(date: Date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Madrid',
    timeZoneName: 'short',
  }).formatToParts(date);

  return parts.find(part => part.type === 'timeZoneName')?.value ?? 'CEST';
}

function formatClockDate(date: Date, timeZone: string) {
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: '2-digit',
    timeZone,
  });
}

function formatClockTime(date: Date, timeZone: string) {
  return date.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZone,
  });
}

function getPlotTimeZoneConfig(plotTimeZone: PlotTimeZone | undefined) {
  return PLOT_TIME_ZONE_CONFIG[plotTimeZone ?? 'UTC'];
}

function parseTelemetryDate(value: string) {
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(value)) {
    return new Date(value);
  }

  return new Date(`${value.replace(' ', 'T')}Z`);
}

function formatChartTime(value: string, plotTimeZone: PlotTimeZone | undefined) {
  const timeZoneConfig = getPlotTimeZoneConfig(plotTimeZone);

  return parseTelemetryDate(value).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: timeZoneConfig.timeZone,
  });
}

function formatDateTime(value: string | null | undefined, plotTimeZone: PlotTimeZone = 'UTC') {
  if (!value) {
    return 'Not available';
  }

  const date = parseTelemetryDate(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString('en-US', {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZone: getPlotTimeZoneConfig(plotTimeZone).timeZone,
  }) + ` ${getPlotTimeZoneConfig(plotTimeZone).label}`;
}

function formatDuration(seconds: number | null) {
  if (seconds === null) {
    return 'Not available';
  }

  const totalMinutes = Math.round(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  return `${hours}h ${minutes}m`;
}

function formatNumber(value: number | null, maximumFractionDigits = 1) {
  if (value === null) {
    return 'Not available';
  }

  return value.toLocaleString('en-US', { maximumFractionDigits });
}

function getStatusMeta(status: SpacecraftConnectionStatus) {
  if (status === 'live') {
    return {
      label: 'Live',
      className: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200',
    };
  }

  if (status === 'stale') {
    return {
      label: 'Stale',
      className: 'border-amber-300/30 bg-amber-300/10 text-amber-100',
    };
  }

  return {
    label: 'Off',
    className: 'border-slate-700 bg-slate-800/60 text-slate-500',
  };
}

const StatusPill = ({ status }: { status: SpacecraftConnectionStatus }) => {
  const statusMeta = getStatusMeta(status);

  return (
    <span className={`rounded border px-2 py-0.5 text-[9px] font-mono uppercase tracking-widest ${statusMeta.className}`}>
      {statusMeta.label}
    </span>
  );
};

function getSourceReadinessMeta(readiness: PublicDataReadiness) {
  if (readiness === 'connected') {
    return {
      label: 'Connected',
      className: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200',
    };
  }

  if (readiness === 'candidate') {
    return {
      label: 'Candidate',
      className: 'border-cyan-400/30 bg-cyan-400/10 text-cyan-100',
    };
  }

  if (readiness === 'archive') {
    return {
      label: 'Archive',
      className: 'border-amber-300/30 bg-amber-300/10 text-amber-100',
    };
  }

  return {
    label: 'Gap',
    className: 'border-rose-400/30 bg-rose-400/10 text-rose-100',
  };
}

const SourceReadinessPill = ({ readiness }: { readiness: PublicDataReadiness }) => {
  const statusMeta = getSourceReadinessMeta(readiness);

  return (
    <span className={`rounded border px-2 py-0.5 text-[9px] font-mono uppercase tracking-widest ${statusMeta.className}`}>
      {statusMeta.label}
    </span>
  );
};

const MetricCard = ({ label, value }: { label: string; value: string }) => (
  <div className="min-w-0 rounded-md border border-slate-800 bg-slate-950/50 p-3">
    <div className="text-[10px] uppercase tracking-widest text-slate-500">{label}</div>
    <div className="mt-2 truncate font-mono text-sm text-slate-100">{value}</div>
  </div>
);

function SourceCatalogCard({
  source,
  selectable = false,
  selected = false,
  onToggle,
}: {
  source: PublicSpaceWeatherSource;
  selectable?: boolean;
  selected?: boolean;
  onToggle?: (sourceId: string) => void;
}) {
  const content = (
    <>
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h3 className="truncate text-sm font-semibold text-slate-100">{source.name}</h3>
            <span className="rounded border border-slate-700 bg-slate-950 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest text-slate-400">
              {source.orbit}
            </span>
            <span className="rounded border border-slate-700 bg-slate-950 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest text-slate-400">
              {source.cadence}
            </span>
          </div>
          <div className="mt-1 truncate font-mono text-[10px] uppercase tracking-widest text-slate-500">
            {source.provider}
          </div>
        </div>
        <SourceReadinessPill readiness={source.readiness} />
      </div>

      <p className="mt-3 text-sm leading-relaxed text-slate-400">{source.useCase}</p>

      <div className="mt-3 grid gap-2 rounded-md border border-slate-800 bg-slate-950/50 p-3 font-mono text-[10px] text-slate-400 sm:grid-cols-2">
        <div className="min-w-0">
          <div className="uppercase tracking-widest text-slate-600">Access</div>
          <div className="mt-1 truncate text-slate-300" title={source.access}>{source.access}</div>
        </div>
        <div className="min-w-0">
          <div className="uppercase tracking-widest text-slate-600">Endpoint</div>
          <div className="mt-1 truncate text-cyan-300/70" title={source.endpoint}>{source.endpoint}</div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {source.variables.slice(0, 5).map(variable => (
          <span
            key={variable}
            className="rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-[10px] text-slate-300"
          >
            {variable}
          </span>
        ))}
        {source.variables.length > 5 && (
          <span className="rounded border border-slate-800 bg-slate-950 px-2 py-1 font-mono text-[10px] text-slate-500">
            +{source.variables.length - 5}
          </span>
        )}
      </div>

      <div className="mt-3 flex min-w-0 items-center justify-between gap-3">
        <div className="min-w-0 truncate font-mono text-[10px] text-slate-500" title={source.spacecraft.join(', ')}>
          {source.spacecraft.join(' / ')}
        </div>
        <a
          href={source.url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-slate-700 px-2.5 text-xs text-slate-300 transition hover:border-cyan-400/40 hover:bg-cyan-400/10 hover:text-cyan-100"
          onClick={event => event.stopPropagation()}
        >
          <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Source</span>
        </a>
      </div>
    </>
  );

  if (selectable) {
    return (
      <article
        className={`min-w-0 rounded-lg border p-4 text-left transition ${
          selected
            ? 'border-cyan-400/45 bg-cyan-400/10 shadow-inner shadow-cyan-950/20'
            : 'border-slate-800 bg-slate-950/45 hover:border-slate-600 hover:bg-slate-900/50'
        }`}
      >
        <button
          type="button"
          aria-pressed={selected}
          onClick={() => onToggle?.(source.id)}
          className="mb-3 flex h-7 items-center gap-2 rounded-md border border-slate-700 bg-slate-950/60 px-2 font-mono text-[10px] uppercase tracking-widest text-slate-400 transition hover:border-cyan-400/40 hover:text-cyan-100"
        >
          <span className={`flex h-4 w-4 items-center justify-center rounded border ${
            selected ? 'border-cyan-300 bg-cyan-300 text-slate-950' : 'border-slate-600'
          }`}>
            {selected && <Check className="h-3 w-3" aria-hidden="true" />}
          </span>
          <span>{selected ? 'Selected' : 'Select'}</span>
        </button>
        {content}
      </article>
    );
  }

  return (
    <article className="min-w-0 rounded-lg border border-slate-800 bg-slate-950/45 p-4">
      {content}
    </article>
  );
}

function SourceCatalogGrid({
  sources,
  selectable = false,
  selectedSourceIds = [],
  onToggleSource,
}: {
  sources: PublicSpaceWeatherSource[];
  selectable?: boolean;
  selectedSourceIds?: string[];
  onToggleSource?: (sourceId: string) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 2xl:grid-cols-3">
      {sources.map(source => (
        <SourceCatalogCard
          key={source.id}
          source={source}
          selectable={selectable}
          selected={selectedSourceIds.includes(source.id)}
          onToggle={onToggleSource}
        />
      ))}
    </div>
  );
}

function MissionInfoModal({
  spacecraftTelemetry,
  onClose,
}: {
  spacecraftTelemetry: SpacecraftTelemetry[];
  onClose: () => void;
}) {
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  return (
    <div className="fixed inset-0 z-[2147483647] bg-slate-950/85 p-4 backdrop-blur-md sm:p-8">
      <button
        type="button"
        aria-label="Cerrar informacion de misiones"
        className="absolute inset-0 cursor-default"
        onClick={onClose}
      />

      <section className="relative mx-auto flex h-full max-h-[900px] w-full max-w-6xl flex-col overflow-hidden rounded-lg border border-slate-700 bg-slate-950 text-slate-200 shadow-2xl shadow-cyan-950/30">
        <header className="flex shrink-0 items-center justify-between gap-4 border-b border-slate-800 px-5 py-4">
          <div className="min-w-0">
            <div className="font-mono text-[10px] uppercase tracking-[0.28em] text-cyan-300">
              Mapa de fuentes
            </div>
            <h2 className="mt-1 truncate text-xl font-semibold text-slate-100">
              Misiones, naves y variables
            </h2>
          </div>
          <button
            type="button"
            aria-label="Cerrar"
            onClick={onClose}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-slate-700 text-slate-300 transition hover:border-cyan-400/40 hover:text-cyan-100"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <div className="grid gap-4 lg:grid-cols-2">
            {spacecraftTelemetry.map(mission => (
              <article
                key={mission.id}
                className="rounded-lg border border-slate-800 bg-slate-900/35 p-4"
              >
                <div className="mb-3 flex min-w-0 items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="truncate text-base font-semibold text-slate-100">{mission.displayName}</h3>
                    <div className="mt-1 truncate font-mono text-[10px] uppercase tracking-widest text-slate-500">
                      {mission.source}
                    </div>
                  </div>
                  <StatusPill status={mission.status} />
                </div>

                <div className="space-y-3 text-sm text-slate-300">
                  <div>
                    <div className="mb-1 font-mono text-[9px] uppercase tracking-widest text-slate-500">
                      Plataforma / satelite
                    </div>
                    <p className="leading-relaxed">{mission.platform}</p>
                  </div>

                  <div>
                    <div className="mb-1 font-mono text-[9px] uppercase tracking-widest text-slate-500">
                      Feed
                    </div>
                    <div className="mt-1 truncate font-mono text-[10px] text-cyan-300/70" title={mission.endpoint}>
                      {mission.endpoint}
                    </div>
                  </div>

                  <p className="leading-relaxed text-slate-400">{mission.description}</p>

                  <div className="grid gap-2 rounded-md border border-slate-800 bg-slate-950/50 p-3 font-mono text-[10px] uppercase tracking-widest text-slate-500 sm:grid-cols-2">
                    <div>
                      <span className="block text-slate-600">Ultimo dato</span>
                      <span className="mt-1 block truncate text-slate-300">
                        {mission.lastSampleTime ? formatDateTime(mission.lastSampleTime) : 'Sin muestras'}
                      </span>
                    </div>
                    <div>
                      <span className="block text-slate-600">Plots</span>
                      <span className="mt-1 block text-slate-300">{mission.charts.length}</span>
                    </div>
                  </div>

                  <div>
                    <div className="mb-2 font-mono text-[9px] uppercase tracking-widest text-slate-500">
                      Variables
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {mission.variables.map(variable => (
                        <span
                          key={variable}
                          className="rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-[10px] text-slate-300"
                        >
                          {variable}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

function LiveDualClock() {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setNow(new Date());
    }, 1000);

    return () => window.clearInterval(interval);
  }, []);

  const madridLabel = now ? getMadridTimeZoneLabel(now) : 'CEST';
  const utcTime = now ? formatClockTime(now, 'UTC') : '--:--:--';
  const utcDate = now ? formatClockDate(now, 'UTC') : '--- --';
  const madridTime = now ? formatClockTime(now, 'Europe/Madrid') : '--:--:--';
  const madridDate = now ? formatClockDate(now, 'Europe/Madrid') : '--- --';

  return (
    <div className="hidden min-w-0 items-stretch gap-2 lg:flex">
      <div className="min-w-[188px] rounded-md border border-slate-700/70 bg-slate-950/60 px-3 py-2 shadow-inner shadow-cyan-950/20">
        <div className="mb-1 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest text-slate-500">
          <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />
          <span>UTC</span>
        </div>
        <div className="font-mono text-xl font-semibold leading-none tracking-wider text-slate-100 tabular-nums">
          {utcTime}
        </div>
        <div className="mt-1 font-mono text-[10px] uppercase tracking-widest text-slate-600">
          {utcDate}
        </div>
      </div>

      <div className="min-w-[188px] rounded-md border border-cyan-400/30 bg-cyan-400/10 px-3 py-2 shadow-[0_0_22px_rgba(34,211,238,0.08)]">
        <div className="mb-1 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest text-cyan-400/70">
          <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />
          <span>{madridLabel}</span>
        </div>
        <div className="font-mono text-xl font-semibold leading-none tracking-wider text-cyan-100 tabular-nums">
          {madridTime}
        </div>
        <div className="mt-1 font-mono text-[10px] uppercase tracking-widest text-cyan-400/50">
          {madridDate} Madrid
        </div>
      </div>
    </div>
  );
}

function TelemetryChart({
  definition,
  plotTimeZone,
}: {
  definition: ChartDefinition;
  plotTimeZone: PlotTimeZone;
}) {
  const chartContainerRef = useRef<HTMLDivElement | null>(null);
  const [chartSize, setChartSize] = useState<{ width: number; height: number } | null>(null);
  const chartData = useMemo(
    () =>
      definition.data.map((point) => ({
        time: point.time_tag ? formatChartTime(point.time_tag, plotTimeZone) : '',
        value: parseMetric(point[definition.dataKey]),
      })),
    [definition, plotTimeZone],
  );

  const hasData = definition.status !== 'off' && chartData.some((point) => point.value !== null);

  useEffect(() => {
    const chartContainer = chartContainerRef.current;

    if (!chartContainer) {
      return;
    }

    const updateChartReadiness = () => {
      const { width, height } = chartContainer.getBoundingClientRect();

      if (width <= 0 || height <= 0) {
        setChartSize(null);
        return;
      }

      const nextSize = {
        width: Math.floor(width),
        height: Math.floor(height),
      };

      setChartSize(currentSize =>
        currentSize?.width === nextSize.width && currentSize.height === nextSize.height
          ? currentSize
          : nextSize,
      );
    };

    updateChartReadiness();

    const resizeObserver = new ResizeObserver(updateChartReadiness);
    resizeObserver.observe(chartContainer);

    return () => resizeObserver.disconnect();
  }, [hasData]);

  return (
    <div className="min-h-[210px] min-w-0 rounded-lg border border-slate-800 bg-slate-950/60 p-3">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-xs font-semibold uppercase tracking-widest text-slate-300">
            {definition.spacecraftName} · {definition.title}
          </h3>
          <div className="mt-1 truncate font-mono text-[10px] text-slate-500">
            {definition.unit} · {definition.source}
          </div>
          <div className={`mt-1 truncate font-mono text-[10px] ${
            definition.status === 'stale' ? 'text-amber-200/80' : 'text-slate-500'
          }`}>
            Last sample: {definition.lastSampleTime ? formatDateTime(definition.lastSampleTime, plotTimeZone) : 'Not available'}
          </div>
        </div>
        <StatusPill status={definition.status} />
      </div>

      {hasData ? (
        <div ref={chartContainerRef} className="h-36 min-h-36 min-w-0">
          {chartSize ? (
            <LineChart
              data={chartData}
              height={chartSize.height}
              margin={{ top: 8, right: 8, left: -18, bottom: 0 }}
              width={chartSize.width}
            >
              <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="time" fontSize={10} minTickGap={24} stroke="#64748b" tickMargin={6} />
              <YAxis
                domain={['auto', 'auto']}
                fontSize={10}
                stroke="#64748b"
                tickFormatter={(value: number | string) => Number(value).toFixed(1)}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#020617',
                  border: '1px solid #334155',
                  borderRadius: '6px',
                  color: '#e2e8f0',
                  fontSize: '12px',
                }}
                formatter={(value) => {
                  const numericValue = Number(value);
                  return [
                    Number.isFinite(numericValue) ? numericValue.toFixed(2) : 'Not available',
                    definition.unit,
                  ];
                }}
                labelStyle={{ color: '#94a3b8' }}
              />
              <Line
                activeDot={{ r: 3, strokeWidth: 0 }}
                connectNulls={false}
                dataKey="value"
                dot={false}
                isAnimationActive={false}
                stroke={definition.color}
                strokeWidth={1.6}
                type="linear"
              />
            </LineChart>
          ) : (
            <div className="flex h-full items-center justify-center rounded border border-slate-800 bg-slate-900/30">
              <span className="font-mono text-[10px] uppercase tracking-widest text-slate-600">
                Loading
              </span>
            </div>
          )}
        </div>
      ) : (
        <div className="flex h-36 items-center justify-center rounded border border-slate-800 bg-slate-900/30">
          <span className="font-mono text-[10px] uppercase tracking-widest text-slate-600">
            {hasData ? 'Loading' : 'Not available'}
          </span>
        </div>
      )}
    </div>
  );
}

export function PlaygroundDashboard({
  adminEmail,
  noaaMagData: initialNoaaMagData,
  noaaPlasmaData: initialNoaaPlasmaData,
  noaaEphemerisData: initialNoaaEphemerisData,
  spacecraftTelemetry: initialSpacecraftTelemetry,
}: PlaygroundDashboardProps) {
  const [telemetryData, setTelemetryData] = useState<PlaygroundTelemetryData>({
    noaaMagData: initialNoaaMagData,
    noaaPlasmaData: initialNoaaPlasmaData,
    noaaEphemerisData: initialNoaaEphemerisData,
    spacecraftTelemetry: initialSpacecraftTelemetry,
  });
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [pipelineHealth, setPipelineHealth] = useState<PipelineHealthSnapshot | null>(null);
  const [isPipelineHealthRefreshing, setIsPipelineHealthRefreshing] = useState(false);
  const [pipelineHealthError, setPipelineHealthError] = useState<string | null>(null);
  const [dataQuality, setDataQuality] = useState<DataQualitySnapshot | null>(null);
  const [isDataQualityRefreshing, setIsDataQualityRefreshing] = useState(false);
  const [dataQualityError, setDataQualityError] = useState<string | null>(null);
  const [univariateEda, setUnivariateEda] = useState<UnivariateEdaSnapshot | null>(null);
  const [isUnivariateEdaRefreshing, setIsUnivariateEdaRefreshing] = useState(false);
  const [univariateEdaError, setUnivariateEdaError] = useState<string | null>(null);
  const [l1EarthCoupling, setL1EarthCoupling] = useState<L1EarthCouplingSnapshot | null>(null);
  const [isL1EarthCouplingRefreshing, setIsL1EarthCouplingRefreshing] = useState(false);
  const [l1EarthCouplingError, setL1EarthCouplingError] = useState<string | null>(null);
  const [featureWorkbench, setFeatureWorkbench] = useState<FeatureWorkbenchSnapshot | null>(null);
  const [isFeatureWorkbenchRefreshing, setIsFeatureWorkbenchRefreshing] = useState(false);
  const [featureWorkbenchError, setFeatureWorkbenchError] = useState<string | null>(null);
  const [baselinesLab, setBaselinesLab] = useState<BaselinesLabSnapshot | null>(null);
  const [isBaselinesLabRefreshing, setIsBaselinesLabRefreshing] = useState(false);
  const [baselinesLabError, setBaselinesLabError] = useState<string | null>(null);
  const [sequenceModels, setSequenceModels] = useState<SequenceModelsSnapshot | null>(null);
  const [isSequenceModelsRefreshing, setIsSequenceModelsRefreshing] = useState(false);
  const [sequenceModelsError, setSequenceModelsError] = useState<string | null>(null);
  const [stormBrowser, setStormBrowser] = useState<StormBrowserSnapshot | null>(null);
  const [isStormBrowserRefreshing, setIsStormBrowserRefreshing] = useState(false);
  const [stormBrowserError, setStormBrowserError] = useState<string | null>(null);
  const [liveForecast, setLiveForecast] = useState<LiveForecastSnapshot | null>(null);
  const [isLiveForecastRefreshing, setIsLiveForecastRefreshing] = useState(false);
  const [liveForecastError, setLiveForecastError] = useState<string | null>(null);
  const [plotTimeZone, setPlotTimeZone] = useState<PlotTimeZone>('UTC');
  const [activeTab, setActiveTab] = useState<PlaygroundTab>('insitu');
  const [isMissionInfoOpen, setIsMissionInfoOpen] = useState(false);
  const [selectedSpacecraftIds, setSelectedSpacecraftIds] = useState<SpacecraftId[]>(['DSCOVR']);
  const [historicRange, setHistoricRange] = useState(getDefaultHistoricRange);
  const [selectedHistoricSourceIds, setSelectedHistoricSourceIds] = useState<string[]>([
    'omni-hro',
    'cdaweb-ace-wind-imap',
    'ncei-goes-r-mag-seiss',
    'poes-metop-sem',
  ]);
  const [selectedNearEarthSpacecraft, setSelectedNearEarthSpacecraft] = useState<string[]>(['GOES-19']);
  const [selectedEdaVariable, setSelectedEdaVariable] = useState('all');
  const [selectedEdaStratum, setSelectedEdaStratum] = useState<EdaStratum>('all');
  const [selectedCouplingPairId, setSelectedCouplingPairId] = useState<string | null>(null);
  const [selectedFeatureId, setSelectedFeatureId] = useState<string | null>(null);
  const [selectedBaselineRunId, setSelectedBaselineRunId] = useState<string | null>(null);
  const isRequestInFlightRef = useRef(false);
  const isPipelineHealthRequestInFlightRef = useRef(false);
  const isDataQualityRequestInFlightRef = useRef(false);
  const isUnivariateEdaRequestInFlightRef = useRef(false);
  const isL1EarthCouplingRequestInFlightRef = useRef(false);
  const isFeatureWorkbenchRequestInFlightRef = useRef(false);
  const isBaselinesLabRequestInFlightRef = useRef(false);
  const isSequenceModelsRequestInFlightRef = useRef(false);
  const isStormBrowserRequestInFlightRef = useRef(false);
  const isLiveForecastRequestInFlightRef = useRef(false);
  const isMountedRef = useRef(false);

  const refreshTelemetry = useCallback(async (options: { showActivity?: boolean } = {}) => {
    if (isRequestInFlightRef.current) {
      return;
    }

    const showActivity = options.showActivity ?? true;
    isRequestInFlightRef.current = true;
    if (showActivity) {
      setIsRefreshing(true);
    }
    setRefreshError(null);

    try {
      const response = await fetch('/api/playground/telemetry', {
        cache: 'no-store',
        credentials: 'same-origin',
        headers: {
          Accept: 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Telemetry request failed with ${response.status}`);
      }

      const nextTelemetryData = await response.json() as PlaygroundTelemetryData;

      if (!isMountedRef.current) {
        return;
      }

      setTelemetryData(nextTelemetryData);
    } catch (error) {
      if (!isMountedRef.current) {
        return;
      }

      setRefreshError(error instanceof Error ? error.message : 'Telemetry request failed');
    } finally {
      isRequestInFlightRef.current = false;

      if (showActivity && isMountedRef.current) {
        setIsRefreshing(false);
      }
    }
  }, []);

  const refreshPipelineHealth = useCallback(async (options: { showActivity?: boolean } = {}) => {
    if (isPipelineHealthRequestInFlightRef.current) {
      return;
    }

    const showActivity = options.showActivity ?? true;
    isPipelineHealthRequestInFlightRef.current = true;
    if (showActivity) {
      setIsPipelineHealthRefreshing(true);
    }
    setPipelineHealthError(null);

    try {
      const response = await fetch('/api/playground/pipeline-health', {
        cache: 'no-store',
        credentials: 'same-origin',
        headers: {
          Accept: 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Pipeline health request failed with ${response.status}`);
      }

      const nextPipelineHealth = await response.json() as PipelineHealthSnapshot;

      if (!isMountedRef.current) {
        return;
      }

      setPipelineHealth(nextPipelineHealth);
    } catch (error) {
      if (!isMountedRef.current) {
        return;
      }

      setPipelineHealthError(error instanceof Error ? error.message : 'Pipeline health request failed');
    } finally {
      isPipelineHealthRequestInFlightRef.current = false;

      if (showActivity && isMountedRef.current) {
        setIsPipelineHealthRefreshing(false);
      }
    }
  }, []);

  const refreshDataQuality = useCallback(async (options: { showActivity?: boolean } = {}) => {
    if (isDataQualityRequestInFlightRef.current) {
      return;
    }

    const startUtc = datetimeLocalToUtcIso(historicRange.start);
    const stopUtc = datetimeLocalToUtcIso(historicRange.stop);

    if (!startUtc || !stopUtc) {
      setDataQualityError('Invalid data quality range');
      return;
    }

    const showActivity = options.showActivity ?? true;
    isDataQualityRequestInFlightRef.current = true;
    if (showActivity) {
      setIsDataQualityRefreshing(true);
    }
    setDataQualityError(null);

    try {
      const params = new URLSearchParams({
        startUtc,
        stopUtc,
      });
      const response = await fetch(`/api/playground/data-quality?${params.toString()}`, {
        cache: 'no-store',
        credentials: 'same-origin',
        headers: {
          Accept: 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Data quality request failed with ${response.status}`);
      }

      const nextDataQuality = await response.json() as DataQualitySnapshot;

      if (!isMountedRef.current) {
        return;
      }

      setDataQuality(nextDataQuality);
    } catch (error) {
      if (!isMountedRef.current) {
        return;
      }

      setDataQualityError(error instanceof Error ? error.message : 'Data quality request failed');
    } finally {
      isDataQualityRequestInFlightRef.current = false;

      if (showActivity && isMountedRef.current) {
        setIsDataQualityRefreshing(false);
      }
    }
  }, [historicRange.start, historicRange.stop]);

  const refreshUnivariateEda = useCallback(async (options: { showActivity?: boolean } = {}) => {
    if (isUnivariateEdaRequestInFlightRef.current) {
      return;
    }

    const startUtc = datetimeLocalToUtcIso(historicRange.start);
    const stopUtc = datetimeLocalToUtcIso(historicRange.stop);

    if (!startUtc || !stopUtc) {
      setUnivariateEdaError('Invalid univariate EDA range');
      return;
    }

    const showActivity = options.showActivity ?? true;
    isUnivariateEdaRequestInFlightRef.current = true;
    if (showActivity) {
      setIsUnivariateEdaRefreshing(true);
    }
    setUnivariateEdaError(null);

    try {
      const params = new URLSearchParams({
        startUtc,
        stopUtc,
      });
      const response = await fetch(`/api/playground/univariate-eda?${params.toString()}`, {
        cache: 'no-store',
        credentials: 'same-origin',
        headers: {
          Accept: 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Univariate EDA request failed with ${response.status}`);
      }

      const nextUnivariateEda = await response.json() as UnivariateEdaSnapshot;

      if (!isMountedRef.current) {
        return;
      }

      setUnivariateEda(nextUnivariateEda);
      if (!nextUnivariateEda.availableStrata.includes(selectedEdaStratum)) {
        setSelectedEdaStratum('all');
      }
    } catch (error) {
      if (!isMountedRef.current) {
        return;
      }

      setUnivariateEdaError(error instanceof Error ? error.message : 'Univariate EDA request failed');
    } finally {
      isUnivariateEdaRequestInFlightRef.current = false;

      if (showActivity && isMountedRef.current) {
        setIsUnivariateEdaRefreshing(false);
      }
    }
  }, [historicRange.start, historicRange.stop, selectedEdaStratum]);

  const refreshL1EarthCoupling = useCallback(async (options: { showActivity?: boolean } = {}) => {
    if (isL1EarthCouplingRequestInFlightRef.current) {
      return;
    }

    const startUtc = datetimeLocalToUtcIso(historicRange.start);
    const stopUtc = datetimeLocalToUtcIso(historicRange.stop);

    if (!startUtc || !stopUtc) {
      setL1EarthCouplingError('Invalid L1-Earth coupling range');
      return;
    }

    const showActivity = options.showActivity ?? true;
    isL1EarthCouplingRequestInFlightRef.current = true;
    if (showActivity) {
      setIsL1EarthCouplingRefreshing(true);
    }
    setL1EarthCouplingError(null);

    try {
      const params = new URLSearchParams({
        startUtc,
        stopUtc,
      });
      const response = await fetch(`/api/playground/l1-earth-coupling?${params.toString()}`, {
        cache: 'no-store',
        credentials: 'same-origin',
        headers: {
          Accept: 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`L1-Earth coupling request failed with ${response.status}`);
      }

      const nextL1EarthCoupling = await response.json() as L1EarthCouplingSnapshot;

      if (!isMountedRef.current) {
        return;
      }

      setL1EarthCoupling(nextL1EarthCoupling);
      setSelectedCouplingPairId(currentPairId => (
        currentPairId && nextL1EarthCoupling.pairs.some(pair => pair.id === currentPairId)
          ? currentPairId
          : nextL1EarthCoupling.pairs[0]?.id ?? null
      ));
    } catch (error) {
      if (!isMountedRef.current) {
        return;
      }

      setL1EarthCouplingError(error instanceof Error ? error.message : 'L1-Earth coupling request failed');
    } finally {
      isL1EarthCouplingRequestInFlightRef.current = false;

      if (showActivity && isMountedRef.current) {
        setIsL1EarthCouplingRefreshing(false);
      }
    }
  }, [historicRange.start, historicRange.stop]);

  const refreshFeatureWorkbench = useCallback(async (options: { showActivity?: boolean } = {}) => {
    if (isFeatureWorkbenchRequestInFlightRef.current) {
      return;
    }

    const startUtc = datetimeLocalToUtcIso(historicRange.start);
    const stopUtc = datetimeLocalToUtcIso(historicRange.stop);

    if (!startUtc || !stopUtc) {
      setFeatureWorkbenchError('Invalid feature workbench range');
      return;
    }

    const showActivity = options.showActivity ?? true;
    isFeatureWorkbenchRequestInFlightRef.current = true;
    if (showActivity) {
      setIsFeatureWorkbenchRefreshing(true);
    }
    setFeatureWorkbenchError(null);

    try {
      const params = new URLSearchParams({
        startUtc,
        stopUtc,
        targetSource: 'GOES',
        targetVariable: 'goes_mag_hn',
        targetLabel: 'GOES-R MAG Hn',
      });
      const response = await fetch(`/api/playground/feature-workbench?${params.toString()}`, {
        cache: 'no-store',
        credentials: 'same-origin',
        headers: {
          Accept: 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Feature workbench request failed with ${response.status}`);
      }

      const nextFeatureWorkbench = await response.json() as FeatureWorkbenchSnapshot;

      if (!isMountedRef.current) {
        return;
      }

      setFeatureWorkbench(nextFeatureWorkbench);
      setSelectedFeatureId(currentFeatureId => (
        currentFeatureId && nextFeatureWorkbench.featureDefinitions.some(feature => feature.id === currentFeatureId)
          ? currentFeatureId
          : nextFeatureWorkbench.featureDefinitions[0]?.id ?? null
      ));
    } catch (error) {
      if (!isMountedRef.current) {
        return;
      }

      setFeatureWorkbenchError(error instanceof Error ? error.message : 'Feature workbench request failed');
    } finally {
      isFeatureWorkbenchRequestInFlightRef.current = false;

      if (showActivity && isMountedRef.current) {
        setIsFeatureWorkbenchRefreshing(false);
      }
    }
  }, [historicRange.start, historicRange.stop]);

  const refreshBaselinesLab = useCallback(async (options: { showActivity?: boolean } = {}) => {
    if (isBaselinesLabRequestInFlightRef.current) {
      return;
    }

    const startUtc = datetimeLocalToUtcIso(historicRange.start);
    const stopUtc = datetimeLocalToUtcIso(historicRange.stop);

    if (!startUtc || !stopUtc) {
      setBaselinesLabError('Invalid baselines range');
      return;
    }

    const showActivity = options.showActivity ?? true;
    isBaselinesLabRequestInFlightRef.current = true;
    if (showActivity) {
      setIsBaselinesLabRefreshing(true);
    }
    setBaselinesLabError(null);

    try {
      const params = new URLSearchParams({ startUtc, stopUtc });
      const response = await fetch(`/api/playground/baselines-lab?${params.toString()}`, {
        cache: 'no-store',
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      });

      if (!response.ok) {
        throw new Error(`Baselines lab request failed with ${response.status}`);
      }

      const nextBaselinesLab = await response.json() as BaselinesLabSnapshot;

      if (!isMountedRef.current) {
        return;
      }

      setBaselinesLab(nextBaselinesLab);
      setSelectedBaselineRunId(currentRunId => (
        currentRunId && nextBaselinesLab.runs.some(run => run.runId === currentRunId)
          ? currentRunId
          : nextBaselinesLab.runs[0]?.runId ?? null
      ));
    } catch (error) {
      if (!isMountedRef.current) {
        return;
      }

      setBaselinesLabError(error instanceof Error ? error.message : 'Baselines lab request failed');
    } finally {
      isBaselinesLabRequestInFlightRef.current = false;

      if (showActivity && isMountedRef.current) {
        setIsBaselinesLabRefreshing(false);
      }
    }
  }, [historicRange.start, historicRange.stop]);

  const refreshSequenceModels = useCallback(async (options: { showActivity?: boolean } = {}) => {
    if (isSequenceModelsRequestInFlightRef.current) {
      return;
    }

    const startUtc = datetimeLocalToUtcIso(historicRange.start);
    const stopUtc = datetimeLocalToUtcIso(historicRange.stop);

    if (!startUtc || !stopUtc) {
      setSequenceModelsError('Invalid sequence models range');
      return;
    }

    const showActivity = options.showActivity ?? true;
    isSequenceModelsRequestInFlightRef.current = true;
    if (showActivity) {
      setIsSequenceModelsRefreshing(true);
    }
    setSequenceModelsError(null);

    try {
      const params = new URLSearchParams({ startUtc, stopUtc });
      const response = await fetch(`/api/playground/sequence-models?${params.toString()}`, {
        cache: 'no-store',
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      });

      if (!response.ok) {
        throw new Error(`Sequence models request failed with ${response.status}`);
      }

      const nextSequenceModels = await response.json() as SequenceModelsSnapshot;

      if (isMountedRef.current) {
        setSequenceModels(nextSequenceModels);
      }
    } catch (error) {
      if (isMountedRef.current) {
        setSequenceModelsError(error instanceof Error ? error.message : 'Sequence models request failed');
      }
    } finally {
      isSequenceModelsRequestInFlightRef.current = false;

      if (showActivity && isMountedRef.current) {
        setIsSequenceModelsRefreshing(false);
      }
    }
  }, [historicRange.start, historicRange.stop]);

  const refreshStormBrowser = useCallback(async (options: { showActivity?: boolean } = {}) => {
    if (isStormBrowserRequestInFlightRef.current) {
      return;
    }

    const showActivity = options.showActivity ?? true;
    isStormBrowserRequestInFlightRef.current = true;
    if (showActivity) {
      setIsStormBrowserRefreshing(true);
    }
    setStormBrowserError(null);

    try {
      const response = await fetch('/api/playground/storm-browser', {
        cache: 'no-store',
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      });

      if (!response.ok) {
        throw new Error(`Storm browser request failed with ${response.status}`);
      }

      const nextStormBrowser = await response.json() as StormBrowserSnapshot;

      if (isMountedRef.current) {
        setStormBrowser(nextStormBrowser);
      }
    } catch (error) {
      if (isMountedRef.current) {
        setStormBrowserError(error instanceof Error ? error.message : 'Storm browser request failed');
      }
    } finally {
      isStormBrowserRequestInFlightRef.current = false;

      if (showActivity && isMountedRef.current) {
        setIsStormBrowserRefreshing(false);
      }
    }
  }, []);

  const refreshLiveForecast = useCallback(async (options: { showActivity?: boolean } = {}) => {
    if (isLiveForecastRequestInFlightRef.current) {
      return;
    }

    const showActivity = options.showActivity ?? true;
    isLiveForecastRequestInFlightRef.current = true;
    if (showActivity) {
      setIsLiveForecastRefreshing(true);
    }
    setLiveForecastError(null);

    try {
      const response = await fetch('/api/playground/live-forecast', {
        cache: 'no-store',
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      });

      if (!response.ok) {
        throw new Error(`Live forecast request failed with ${response.status}`);
      }

      const nextLiveForecast = await response.json() as LiveForecastSnapshot;

      if (isMountedRef.current) {
        setLiveForecast(nextLiveForecast);
      }
    } catch (error) {
      if (isMountedRef.current) {
        setLiveForecastError(error instanceof Error ? error.message : 'Live forecast request failed');
      }
    } finally {
      isLiveForecastRequestInFlightRef.current = false;

      if (showActivity && isMountedRef.current) {
        setIsLiveForecastRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    const refreshInterval = window.setInterval(() => {
      void refreshTelemetry({ showActivity: false });
    }, TELEMETRY_POLL_INTERVAL_MS);

    return () => {
      isMountedRef.current = false;
      window.clearInterval(refreshInterval);
    };
  }, [refreshTelemetry]);

  const hasPipelineHealth = pipelineHealth !== null;

  useEffect(() => {
    if (activeTab !== 'pipeline') {
      return;
    }

    let initialRefreshTimeout: number | null = null;

    if (!hasPipelineHealth) {
      initialRefreshTimeout = window.setTimeout(() => {
        void refreshPipelineHealth({ showActivity: true });
      }, 0);
    }

    const refreshInterval = window.setInterval(() => {
      void refreshPipelineHealth({ showActivity: false });
    }, PIPELINE_HEALTH_POLL_INTERVAL_MS);

    return () => {
      if (initialRefreshTimeout !== null) {
        window.clearTimeout(initialRefreshTimeout);
      }

      window.clearInterval(refreshInterval);
    };
  }, [activeTab, hasPipelineHealth, refreshPipelineHealth]);

  const hasDataQuality = dataQuality !== null;

  useEffect(() => {
    if (activeTab !== 'quality') {
      return;
    }

    let initialRefreshTimeout: number | null = null;

    if (!hasDataQuality) {
      initialRefreshTimeout = window.setTimeout(() => {
        void refreshDataQuality({ showActivity: true });
      }, 0);
    }

    return () => {
      if (initialRefreshTimeout !== null) {
        window.clearTimeout(initialRefreshTimeout);
      }
    };
  }, [activeTab, hasDataQuality, refreshDataQuality]);

  const hasUnivariateEda = univariateEda !== null;

  useEffect(() => {
    if (activeTab !== 'eda') {
      return;
    }

    let initialRefreshTimeout: number | null = null;

    if (!hasUnivariateEda) {
      initialRefreshTimeout = window.setTimeout(() => {
        void refreshUnivariateEda({ showActivity: true });
      }, 0);
    }

    return () => {
      if (initialRefreshTimeout !== null) {
        window.clearTimeout(initialRefreshTimeout);
      }
    };
  }, [activeTab, hasUnivariateEda, refreshUnivariateEda]);

  const hasL1EarthCoupling = l1EarthCoupling !== null;

  useEffect(() => {
    if (activeTab !== 'coupling') {
      return;
    }

    let initialRefreshTimeout: number | null = null;

    if (!hasL1EarthCoupling) {
      initialRefreshTimeout = window.setTimeout(() => {
        void refreshL1EarthCoupling({ showActivity: true });
      }, 0);
    }

    return () => {
      if (initialRefreshTimeout !== null) {
        window.clearTimeout(initialRefreshTimeout);
      }
    };
  }, [activeTab, hasL1EarthCoupling, refreshL1EarthCoupling]);

  const hasFeatureWorkbench = featureWorkbench !== null;

  useEffect(() => {
    if (activeTab !== 'features') {
      return;
    }

    let initialRefreshTimeout: number | null = null;

    if (!hasFeatureWorkbench) {
      initialRefreshTimeout = window.setTimeout(() => {
        void refreshFeatureWorkbench({ showActivity: true });
      }, 0);
    }

    return () => {
      if (initialRefreshTimeout !== null) {
        window.clearTimeout(initialRefreshTimeout);
      }
    };
  }, [activeTab, hasFeatureWorkbench, refreshFeatureWorkbench]);

  const hasBaselinesLab = baselinesLab !== null;

  useEffect(() => {
    if (activeTab !== 'baselines') {
      return;
    }

    let initialRefreshTimeout: number | null = null;

    if (!hasBaselinesLab) {
      initialRefreshTimeout = window.setTimeout(() => {
        void refreshBaselinesLab({ showActivity: true });
      }, 0);
    }

    return () => {
      if (initialRefreshTimeout !== null) {
        window.clearTimeout(initialRefreshTimeout);
      }
    };
  }, [activeTab, hasBaselinesLab, refreshBaselinesLab]);

  const hasSequenceModels = sequenceModels !== null;

  useEffect(() => {
    if (activeTab !== 'sequence') {
      return;
    }

    let initialRefreshTimeout: number | null = null;

    if (!hasSequenceModels) {
      initialRefreshTimeout = window.setTimeout(() => {
        void refreshSequenceModels({ showActivity: true });
      }, 0);
    }

    return () => {
      if (initialRefreshTimeout !== null) {
        window.clearTimeout(initialRefreshTimeout);
      }
    };
  }, [activeTab, hasSequenceModels, refreshSequenceModels]);

  const hasStormBrowser = stormBrowser !== null;

  useEffect(() => {
    if (activeTab !== 'storms') {
      return;
    }

    let initialRefreshTimeout: number | null = null;

    if (!hasStormBrowser) {
      initialRefreshTimeout = window.setTimeout(() => {
        void refreshStormBrowser({ showActivity: true });
      }, 0);
    }

    return () => {
      if (initialRefreshTimeout !== null) {
        window.clearTimeout(initialRefreshTimeout);
      }
    };
  }, [activeTab, hasStormBrowser, refreshStormBrowser]);

  const hasLiveForecast = liveForecast !== null;

  useEffect(() => {
    if (activeTab !== 'live') {
      return;
    }

    let initialRefreshTimeout: number | null = null;

    if (!hasLiveForecast) {
      initialRefreshTimeout = window.setTimeout(() => {
        void refreshLiveForecast({ showActivity: true });
      }, 0);
    }

    const refreshInterval = window.setInterval(() => {
      void refreshLiveForecast({ showActivity: false });
    }, PIPELINE_HEALTH_POLL_INTERVAL_MS);

    return () => {
      if (initialRefreshTimeout !== null) {
        window.clearTimeout(initialRefreshTimeout);
      }
      window.clearInterval(refreshInterval);
    };
  }, [activeTab, hasLiveForecast, refreshLiveForecast]);

  const {
    noaaMagData,
    noaaPlasmaData,
    spacecraftTelemetry,
  } = telemetryData;

  const speedKmS = parseMetric(noaaPlasmaData.latestData?.speed);
  const eventTimestamp = noaaPlasmaData.latestData?.time_tag ?? noaaMagData.latestData?.time_tag ?? null;
  const travelSeconds = speedKmS ? L1_TO_EARTH_DISTANCE_KM / speedKmS : null;
  const arrivalTime =
    eventTimestamp && travelSeconds
      ? new Date(parseTelemetryDate(eventTimestamp).getTime() + travelSeconds * 1000).toISOString()
      : null;

  const toggleSpacecraftSelection = useCallback((spacecraftId: SpacecraftId) => {
    setSelectedSpacecraftIds(currentSelection => (
      currentSelection.includes(spacecraftId)
        ? currentSelection.filter(currentId => currentId !== spacecraftId)
        : [...currentSelection, spacecraftId]
    ));
  }, []);

  const toggleHistoricSource = useCallback((sourceId: string) => {
    setSelectedHistoricSourceIds(currentSelection => (
      currentSelection.includes(sourceId)
        ? currentSelection.filter(currentId => currentId !== sourceId)
        : [...currentSelection, sourceId]
    ));
  }, []);

  const toggleNearEarthSpacecraft = useCallback((spacecraftName: string) => {
    setSelectedNearEarthSpacecraft(currentSelection => (
      currentSelection.includes(spacecraftName)
        ? currentSelection.filter(currentName => currentName !== spacecraftName)
        : [...currentSelection, spacecraftName]
    ));
  }, []);

  const selectedSpacecraft = useMemo(
    () => spacecraftTelemetry.filter(mission => selectedSpacecraftIds.includes(mission.id)),
    [selectedSpacecraftIds, spacecraftTelemetry],
  );

  const chartDefinitions = useMemo<ChartDefinition[]>(
    () => selectedSpacecraft.flatMap(mission =>
      mission.charts.map(chart => ({
        id: chart.id,
        spacecraftId: mission.id,
        spacecraftName: mission.displayName,
        source: mission.source,
        title: chart.title,
        unit: chart.unit,
        dataKey: 'value' as const,
        color: chart.color,
        data: chart.data,
        status: mission.status,
        lastSampleTime: mission.lastSampleTime,
      })),
    ),
    [selectedSpacecraft],
  );

  const liveNearEarthSources = useMemo(
    () => NEAR_EARTH_PUBLIC_SOURCES.filter(source => source.cadence !== 'historic'),
    [],
  );
  const historicL1Sources = useMemo(
    () => L1_PUBLIC_SOURCES.filter(source => source.cadence !== 'live'),
    [],
  );
  const historicNearEarthSources = useMemo(
    () => NEAR_EARTH_PUBLIC_SOURCES.filter(source => source.cadence !== 'live'),
    [],
  );
  const nearEarthSpacecraftOptions = useMemo(
    () => Array.from(new Set(liveNearEarthSources.flatMap(source => source.spacecraft))).sort(),
    [liveNearEarthSources],
  );
  const filteredLiveNearEarthSources = useMemo(
    () =>
      liveNearEarthSources.filter(source =>
        selectedNearEarthSpacecraft.length === 0 ||
        source.spacecraft.some(spacecraftName => selectedNearEarthSpacecraft.includes(spacecraftName)),
      ),
    [liveNearEarthSources, selectedNearEarthSpacecraft],
  );
  const selectedHistoricSources = useMemo(
    () =>
      [...historicL1Sources, ...historicNearEarthSources].filter(source =>
        selectedHistoricSourceIds.includes(source.id),
      ),
    [historicL1Sources, historicNearEarthSources, selectedHistoricSourceIds],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <header className="relative z-20 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-700/50 bg-slate-900/40 px-5 py-4 shadow-lg backdrop-blur-md">
        <div className="flex min-w-0 items-center gap-3">
          <Link
            href="/"
            aria-label="Volver"
            className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-md border border-slate-700 text-slate-300 transition hover:border-cyan-400/40 hover:text-cyan-100"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          </Link>
          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-md border border-cyan-400/30 bg-cyan-400/10 text-cyan-200">
            <FlaskConical className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold text-slate-100">Admin Playground</h1>
            <div className="truncate font-mono text-[11px] text-slate-500">{adminEmail ?? 'Admin'}</div>
          </div>
        </div>

        <nav className="order-3 flex w-full min-w-0 overflow-x-auto overflow-y-hidden rounded-md border border-slate-700/70 bg-slate-950/60 p-1 [scrollbar-width:thin] md:order-none md:flex-1">
          {PLAYGROUND_TABS.map(tab => {
            const isSelected = activeTab === tab.id;
            const Icon = tab.id === 'insitu'
              ? Database
              : tab.id === 'historic'
                ? Archive
                : tab.id === 'pipeline'
                  ? Activity
                  : tab.id === 'quality'
                    ? Gauge
                    : tab.id === 'eda'
                      ? Sigma
                      : tab.id === 'coupling'
                        ? Waves
                        : tab.id === 'features'
                          ? Layers3
                          : tab.id === 'storms'
                            ? Globe2
                            : tab.id === 'live'
                              ? RadioTower
                              : Activity;

            return (
              <button
                key={tab.id}
                type="button"
                aria-pressed={isSelected}
                onClick={() => setActiveTab(tab.id)}
                className={`flex min-w-[220px] shrink-0 items-center gap-2 rounded px-3 py-2 text-left transition ${
                  isSelected
                    ? 'bg-cyan-400/15 text-cyan-100'
                    : 'text-slate-500 hover:bg-slate-800/70 hover:text-slate-200'
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span className="min-w-0">
                  <span className="block truncate text-sm">{tab.label}</span>
                  <span className="block truncate font-mono text-[9px] uppercase tracking-widest opacity-70">
                    {tab.description}
                  </span>
                </span>
              </button>
            );
          })}
        </nav>

        <div className="flex items-center gap-3">
          <LiveDualClock />
          {refreshError && (
            <div className="hidden max-w-64 truncate font-mono text-[10px] uppercase tracking-widest text-rose-300 md:block" title={refreshError}>
              Sync error
            </div>
          )}
          <button
            type="button"
            onClick={() => {
              void refreshTelemetry({ showActivity: true });
            }}
            className="flex h-10 items-center gap-2 rounded-md border border-cyan-400/30 bg-cyan-400/10 px-3 text-sm text-cyan-100 transition hover:border-cyan-300/60 hover:bg-cyan-400/15 disabled:cursor-wait disabled:text-slate-500"
            disabled={isRefreshing}
          >
            <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} aria-hidden="true" />
            <span>{isRefreshing ? 'Syncing' : 'Refresh'}</span>
          </button>
        </div>
      </header>

      {activeTab === 'insitu' ? (
        <main className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-y-auto pr-1 xl:grid-cols-[360px_minmax(0,1fr)]">
          <aside className="grid content-start gap-4">
            <section className="rounded-lg border border-slate-700/50 bg-slate-900/30 p-4 shadow-2xl backdrop-blur-xl">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                  <RadioTower className="h-4 w-4 shrink-0 text-cyan-300" aria-hidden="true" />
                  <h2 className="truncate text-xs font-semibold uppercase tracking-widest text-slate-300">
                    L1 missions
                  </h2>
                </div>
                <button
                  type="button"
                  aria-label="Informacion de misiones"
                  onClick={() => setIsMissionInfoOpen(true)}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-slate-700 text-slate-400 transition hover:border-cyan-400/40 hover:bg-cyan-400/10 hover:text-cyan-100"
                >
                  <Info className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
              <div className="grid gap-2">
                {spacecraftTelemetry.map((mission) => {
                  const isSelected = selectedSpacecraftIds.includes(mission.id);

                  return (
                    <button
                      key={mission.id}
                      type="button"
                      aria-pressed={isSelected}
                      onClick={() => toggleSpacecraftSelection(mission.id)}
                      className={`min-w-0 rounded-md border px-3 py-3 text-left transition ${
                        isSelected
                          ? 'border-cyan-400/45 bg-cyan-400/10 shadow-inner shadow-cyan-950/20'
                          : 'border-slate-800 bg-slate-950/40 hover:border-slate-600 hover:bg-slate-900/50'
                      }`}
                    >
                      <span className="flex items-center justify-between gap-3">
                        <span className="flex min-w-0 items-center gap-2">
                          <span
                            className={`h-3 w-3 shrink-0 rounded border ${
                              isSelected
                                ? 'border-cyan-300 bg-cyan-300'
                                : 'border-slate-600 bg-slate-950'
                            }`}
                          />
                          <span className="min-w-0">
                            <span className="block truncate text-sm text-slate-100">{mission.displayName}</span>
                            <span className="block truncate font-mono text-[10px] text-slate-500">
                              {mission.source}
                            </span>
                          </span>
                        </span>
                        <StatusPill status={mission.status} />
                      </span>
                      <span className={`mt-2 block truncate font-mono text-[10px] ${
                        mission.status === 'stale' ? 'text-amber-200/80' : 'text-slate-500'
                      }`}>
                        Last: {mission.lastSampleTime ? formatDateTime(mission.lastSampleTime) : 'No samples'}
                      </span>
                      <span className="mt-2 flex flex-wrap gap-1.5">
                        {mission.variables.slice(0, 5).map(variable => (
                          <span
                            key={variable}
                            className="rounded border border-slate-700 bg-slate-900 px-2 py-1 font-mono text-[10px] text-slate-300"
                          >
                            {variable}
                          </span>
                        ))}
                        {mission.variables.length > 5 && (
                          <span className="rounded border border-slate-800 bg-slate-950 px-2 py-1 font-mono text-[10px] text-slate-500">
                            +{mission.variables.length - 5}
                          </span>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>

            <section className="rounded-lg border border-slate-700/50 bg-slate-900/30 p-4 shadow-2xl backdrop-blur-xl">
              <div className="mb-3 flex items-center gap-2">
                <Activity className="h-4 w-4 text-rose-300" aria-hidden="true" />
                <h2 className="text-xs font-semibold uppercase tracking-widest text-slate-300">
                  MRU L1 to Earth
                </h2>
              </div>
              <div className="grid gap-3">
                <MetricCard label="Evento L1" value={formatDateTime(eventTimestamp)} />
                <MetricCard label="Speed" value={`${formatNumber(speedKmS)} km/s`} />
                <MetricCard label="Distancia" value={`${formatNumber(L1_TO_EARTH_DISTANCE_KM, 0)} km`} />
                <MetricCard label="Transit" value={formatDuration(travelSeconds)} />
                <MetricCard label="ETA Earth" value={formatDateTime(arrivalTime)} />
              </div>
            </section>
          </aside>

          <section className="min-w-0 space-y-4">
            <section className="min-w-0 rounded-lg border border-slate-700/50 bg-slate-900/30 p-4 shadow-2xl backdrop-blur-xl">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                  <Database className="h-4 w-4 text-cyan-300" aria-hidden="true" />
                  <div className="min-w-0">
                    <h2 className="truncate text-xs font-semibold uppercase tracking-widest text-slate-300">
                      L1 in situ telemetry
                    </h2>
                    <div className="mt-1 truncate font-mono text-[10px] uppercase tracking-widest text-slate-500">
                      Current feed when live; full timestamp shown for stale data
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="font-mono text-[10px] uppercase tracking-widest text-slate-500">
                    2H selected series
                  </div>
                  <div className="flex overflow-hidden rounded-md border border-slate-700/70 bg-slate-950/60">
                    {(Object.keys(PLOT_TIME_ZONE_CONFIG) as PlotTimeZone[]).map(timeZoneKey => {
                      const isSelected = plotTimeZone === timeZoneKey;

                      return (
                        <button
                          key={timeZoneKey}
                          type="button"
                          aria-pressed={isSelected}
                          onClick={() => setPlotTimeZone(timeZoneKey)}
                          className={`h-8 px-3 font-mono text-[10px] uppercase tracking-widest transition ${
                            isSelected
                              ? 'bg-cyan-400/15 text-cyan-100'
                              : 'text-slate-500 hover:bg-slate-800/70 hover:text-slate-200'
                          }`}
                        >
                          {PLOT_TIME_ZONE_CONFIG[timeZoneKey].label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
              {chartDefinitions.length > 0 ? (
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 2xl:grid-cols-3">
                  {chartDefinitions.map((definition) => (
                    <TelemetryChart
                      key={definition.id}
                      definition={definition}
                      plotTimeZone={plotTimeZone}
                    />
                  ))}
                </div>
              ) : (
                <div className="flex min-h-[220px] items-center justify-center rounded-lg border border-slate-800 bg-slate-950/50 p-6 text-center">
                  <div>
                    <div className="font-mono text-[10px] uppercase tracking-widest text-slate-500">
                      Sin plots seleccionados
                    </div>
                    <div className="mt-2 text-sm text-slate-400">
                      Selecciona uno o varios spacecraft en L1 missions.
                    </div>
                  </div>
                </div>
              )}
            </section>

            <section className="min-w-0 rounded-lg border border-slate-700/50 bg-slate-900/30 p-4 shadow-2xl backdrop-blur-xl">
              <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                  <Globe2 className="h-4 w-4 text-emerald-300" aria-hidden="true" />
                  <div className="min-w-0">
                    <h2 className="truncate text-xs font-semibold uppercase tracking-widest text-slate-300">
                      Near-Earth public feeds
                    </h2>
                    <div className="mt-1 truncate font-mono text-[10px] uppercase tracking-widest text-slate-500">
                      LEO / MEO / GEO source map for the next chart integration
                    </div>
                  </div>
                </div>
                <div className="flex max-w-full flex-wrap gap-1.5">
                  {nearEarthSpacecraftOptions.map(spacecraftName => {
                    const isSelected = selectedNearEarthSpacecraft.includes(spacecraftName);

                    return (
                      <button
                        key={spacecraftName}
                        type="button"
                        aria-pressed={isSelected}
                        onClick={() => toggleNearEarthSpacecraft(spacecraftName)}
                        className={`h-8 rounded-md border px-2.5 font-mono text-[10px] uppercase tracking-widest transition ${
                          isSelected
                            ? 'border-emerald-300/50 bg-emerald-300/10 text-emerald-100'
                            : 'border-slate-700 bg-slate-950/50 text-slate-500 hover:border-slate-500 hover:text-slate-200'
                        }`}
                      >
                        {spacecraftName}
                      </button>
                    );
                  })}
                </div>
              </div>
              {filteredLiveNearEarthSources.length > 0 ? (
                <SourceCatalogGrid sources={filteredLiveNearEarthSources} />
              ) : (
                <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-6 text-center text-sm text-slate-400">
                  No near-Earth live source matches the selected spacecraft filter.
                </div>
              )}
            </section>
          </section>
        </main>
      ) : activeTab === 'historic' ? (
        <main className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-y-auto pr-1 xl:grid-cols-[360px_minmax(0,1fr)]">
          <aside className="grid content-start gap-4">
            <section className="rounded-lg border border-slate-700/50 bg-slate-900/30 p-4 shadow-2xl backdrop-blur-xl">
              <div className="mb-3 flex items-center gap-2">
                <CalendarRange className="h-4 w-4 text-cyan-300" aria-hidden="true" />
                <h2 className="text-xs font-semibold uppercase tracking-widest text-slate-300">
                  Historic window
                </h2>
              </div>
              <div className="grid gap-3">
                <label className="grid gap-1.5">
                  <span className="font-mono text-[10px] uppercase tracking-widest text-slate-500">Start UTC</span>
                  <input
                    type="datetime-local"
                    value={historicRange.start}
                    onChange={event => {
                      setHistoricRange(current => ({ ...current, start: event.target.value }));
                      setDataQuality(null);
                      setUnivariateEda(null);
                      setL1EarthCoupling(null);
                      setFeatureWorkbench(null);
                      setBaselinesLab(null);
                      setSequenceModels(null);
                    }}
                    className="h-10 rounded-md border border-slate-700 bg-slate-950 px-3 font-mono text-sm text-slate-100 outline-none transition focus:border-cyan-400/60"
                  />
                </label>
                <label className="grid gap-1.5">
                  <span className="font-mono text-[10px] uppercase tracking-widest text-slate-500">Stop UTC</span>
                  <input
                    type="datetime-local"
                    value={historicRange.stop}
                    onChange={event => {
                      setHistoricRange(current => ({ ...current, stop: event.target.value }));
                      setDataQuality(null);
                      setUnivariateEda(null);
                      setL1EarthCoupling(null);
                      setFeatureWorkbench(null);
                      setBaselinesLab(null);
                      setSequenceModels(null);
                    }}
                    className="h-10 rounded-md border border-slate-700 bg-slate-950 px-3 font-mono text-sm text-slate-100 outline-none transition focus:border-cyan-400/60"
                  />
                </label>
              </div>
            </section>

            <section className="rounded-lg border border-slate-700/50 bg-slate-900/30 p-4 shadow-2xl backdrop-blur-xl">
              <div className="mb-3 flex items-center gap-2">
                <ListFilter className="h-4 w-4 text-amber-300" aria-hidden="true" />
                <h2 className="text-xs font-semibold uppercase tracking-widest text-slate-300">
                  Selected data sets
                </h2>
              </div>
              <div className="grid gap-2">
                {selectedHistoricSources.length > 0 ? (
                  selectedHistoricSources.map(source => (
                    <div
                      key={source.id}
                      className="rounded-md border border-slate-800 bg-slate-950/50 p-3"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0 truncate text-sm text-slate-100">{source.name}</div>
                        <span className="rounded border border-slate-700 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest text-slate-400">
                          {source.orbit}
                        </span>
                      </div>
                      <div className="mt-1 truncate font-mono text-[10px] text-slate-500">
                        {source.provider}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="rounded-md border border-slate-800 bg-slate-950/50 p-3 text-sm text-slate-500">
                    No historical datasets selected.
                  </div>
                )}
              </div>
            </section>
          </aside>

          <section className="min-w-0 space-y-4">
            <section className="rounded-lg border border-slate-700/50 bg-slate-900/30 p-4 shadow-2xl backdrop-blur-xl">
              <div className="mb-4 flex min-w-0 items-center gap-2">
                <Layers3 className="h-4 w-4 text-cyan-300" aria-hidden="true" />
                <div className="min-w-0">
                  <h2 className="truncate text-xs font-semibold uppercase tracking-widest text-slate-300">
                    L1 historic data
                  </h2>
                  <div className="mt-1 truncate font-mono text-[10px] uppercase tracking-widest text-slate-500">
                    Select L1 sources for model-validation extraction windows
                  </div>
                </div>
              </div>
              <SourceCatalogGrid
                sources={historicL1Sources}
                selectable
                selectedSourceIds={selectedHistoricSourceIds}
                onToggleSource={toggleHistoricSource}
              />
            </section>

            <section className="rounded-lg border border-slate-700/50 bg-slate-900/30 p-4 shadow-2xl backdrop-blur-xl">
              <div className="mb-4 flex min-w-0 items-center gap-2">
                <Satellite className="h-4 w-4 text-emerald-300" aria-hidden="true" />
                <div className="min-w-0">
                  <h2 className="truncate text-xs font-semibold uppercase tracking-widest text-slate-300">
                    Near-Earth historic data
                  </h2>
                  <div className="mt-1 truncate font-mono text-[10px] uppercase tracking-widest text-slate-500">
                    Public LEO / MEO / GEO sources found for validation coverage
                  </div>
                </div>
              </div>
              <SourceCatalogGrid
                sources={historicNearEarthSources}
                selectable
                selectedSourceIds={selectedHistoricSourceIds}
                onToggleSource={toggleHistoricSource}
              />
            </section>
          </section>
        </main>
      ) : activeTab === 'pipeline' ? (
        <PipelineHealthPanel
          snapshot={pipelineHealth}
          isLoading={isPipelineHealthRefreshing}
          error={pipelineHealthError}
          onRefresh={() => {
            void refreshPipelineHealth({ showActivity: true });
          }}
        />
      ) : activeTab === 'quality' ? (
        <DataQualityPanel
          snapshot={dataQuality}
          isLoading={isDataQualityRefreshing}
          error={dataQualityError}
          range={historicRange}
          onRangeChange={(nextRange) => {
            setHistoricRange(nextRange);
            setDataQuality(null);
            setUnivariateEda(null);
            setL1EarthCoupling(null);
            setFeatureWorkbench(null);
            setBaselinesLab(null);
            setSequenceModels(null);
          }}
          onRefresh={() => {
            void refreshDataQuality({ showActivity: true });
          }}
        />
      ) : activeTab === 'eda' ? (
        <UnivariateEdaPanel
          snapshot={univariateEda}
          isLoading={isUnivariateEdaRefreshing}
          error={univariateEdaError}
          selectedVariable={selectedEdaVariable}
          selectedStratum={selectedEdaStratum}
          onVariableChange={setSelectedEdaVariable}
          onStratumChange={setSelectedEdaStratum}
          onRefresh={() => {
            void refreshUnivariateEda({ showActivity: true });
          }}
        />
      ) : activeTab === 'coupling' ? (
        <L1EarthCouplingPanel
          snapshot={l1EarthCoupling}
          isLoading={isL1EarthCouplingRefreshing}
          error={l1EarthCouplingError}
          selectedPairId={selectedCouplingPairId}
          onSelectedPairChange={setSelectedCouplingPairId}
          onRefresh={() => {
            void refreshL1EarthCoupling({ showActivity: true });
          }}
        />
      ) : activeTab === 'features' ? (
        <FeatureWorkbenchPanel
          snapshot={featureWorkbench}
          isLoading={isFeatureWorkbenchRefreshing}
          error={featureWorkbenchError}
          selectedFeatureId={selectedFeatureId}
          onSelectedFeatureChange={setSelectedFeatureId}
          onRefresh={() => {
            void refreshFeatureWorkbench({ showActivity: true });
          }}
        />
      ) : activeTab === 'baselines' ? (
        <BaselinesLabPanel
          snapshot={baselinesLab}
          isLoading={isBaselinesLabRefreshing}
          error={baselinesLabError}
          selectedRunId={selectedBaselineRunId}
          onSelectedRunChange={setSelectedBaselineRunId}
          onRefresh={() => {
            void refreshBaselinesLab({ showActivity: true });
          }}
        />
      ) : activeTab === 'sequence' ? (
        <SequenceModelsPanel
          snapshot={sequenceModels}
          isLoading={isSequenceModelsRefreshing}
          error={sequenceModelsError}
          onRefresh={() => {
            void refreshSequenceModels({ showActivity: true });
          }}
        />
      ) : activeTab === 'storms' ? (
        <StormBrowserPanel
          snapshot={stormBrowser}
          isLoading={isStormBrowserRefreshing}
          error={stormBrowserError}
          onRefresh={() => {
            void refreshStormBrowser({ showActivity: true });
          }}
        />
      ) : (
        <LiveForecastPanel
          snapshot={liveForecast}
          isLoading={isLiveForecastRefreshing}
          error={liveForecastError}
          onRefresh={() => {
            void refreshLiveForecast({ showActivity: true });
          }}
        />
      )}

      {isMissionInfoOpen && (
        <MissionInfoModal
          spacecraftTelemetry={spacecraftTelemetry}
          onClose={() => setIsMissionInfoOpen(false)}
        />
      )}
    </div>
  );
}
