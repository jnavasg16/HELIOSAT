"use client";

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  ArrowLeft,
  Clock3,
  FlaskConical,
  Info,
  RefreshCw,
  RadioTower,
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

interface PlaygroundDashboardProps extends PlaygroundTelemetryData {
  adminEmail: string | null;
}

const L1_TO_EARTH_DISTANCE_KM = 1_500_000;
const TELEMETRY_POLL_INTERVAL_MS = 30_000;
const PLOT_TIME_ZONE_CONFIG: Record<PlotTimeZone, { label: string; timeZone: string }> = {
  UTC: { label: 'UTC', timeZone: 'UTC' },
  CEST: { label: 'CEST', timeZone: 'Europe/Madrid' },
};

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
      label: 'Data',
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

const MetricCard = ({ label, value }: { label: string; value: string }) => (
  <div className="min-w-0 rounded-md border border-slate-800 bg-slate-950/50 p-3">
    <div className="text-[10px] uppercase tracking-widest text-slate-500">{label}</div>
    <div className="mt-2 truncate font-mono text-sm text-slate-100">{value}</div>
  </div>
);

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
                    <p className="leading-relaxed">{mission.platform}</p>
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
    setNow(new Date());
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
  const [plotTimeZone, setPlotTimeZone] = useState<PlotTimeZone>('UTC');
  const [isMissionInfoOpen, setIsMissionInfoOpen] = useState(false);
  const [selectedSpacecraftIds, setSelectedSpacecraftIds] = useState<SpacecraftId[]>(['DSCOVR']);
  const isRequestInFlightRef = useRef(false);
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

      <main className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-y-auto pr-1 xl:grid-cols-[360px_minmax(0,1fr)]">
        <aside className="grid content-start gap-4">
          <section className="rounded-lg border border-slate-700/50 bg-slate-900/30 p-4 shadow-2xl backdrop-blur-xl">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <RadioTower className="h-4 w-4 shrink-0 text-cyan-300" aria-hidden="true" />
                <h2 className="truncate text-xs font-semibold uppercase tracking-widest text-slate-300">
                  Misiones
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

        <section className="min-w-0 rounded-lg border border-slate-700/50 bg-slate-900/30 p-4 shadow-2xl backdrop-blur-xl">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-xs font-semibold uppercase tracking-widest text-slate-300">
              Telemetry Plots
            </h2>
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
                  Selecciona uno o varios spacecraft en Misiones.
                </div>
              </div>
            </div>
          )}
        </section>
      </main>

      {isMissionInfoOpen && (
        <MissionInfoModal
          spacecraftTelemetry={spacecraftTelemetry}
          onClose={() => setIsMissionInfoOpen(false)}
        />
      )}
    </div>
  );
}
