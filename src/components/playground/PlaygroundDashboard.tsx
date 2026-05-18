"use client";

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useTransition } from 'react';
import {
  Activity,
  ArrowLeft,
  Clock3,
  FlaskConical,
  RefreshCw,
  RadioTower,
} from 'lucide-react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type {
  NoaaEphemerisData,
  NoaaMagnetometerData,
  NoaaPlasmaData,
  NoaaServiceResponse,
} from '@/services/noaaSolarWindService';
import type { NoaaAlertsResponse } from '@/services/noaaAlertsService';
import type { CelesTrakResponse } from '@/services/celestrakService';

type ChartDataKey =
  | 'bt'
  | 'bx_gsm'
  | 'by_gsm'
  | 'bz_gsm'
  | 'density'
  | 'speed'
  | 'temperature'
  | 'x_gse'
  | 'y_gse'
  | 'z_gse';

type ChartSourceRow = {
  time_tag: string;
} & Partial<Record<ChartDataKey, string | null>>;

type ChartDefinition = {
  title: string;
  unit: string;
  dataKey: ChartDataKey;
  color: string;
  data: ChartSourceRow[];
  isConnected: boolean;
};

interface PlaygroundDashboardProps {
  adminEmail: string | null;
  noaaMagData: NoaaServiceResponse<NoaaMagnetometerData>;
  noaaPlasmaData: NoaaServiceResponse<NoaaPlasmaData>;
  noaaEphemerisData: NoaaServiceResponse<NoaaEphemerisData>;
  noaaAlertsData: NoaaAlertsResponse;
  celestrakData: CelesTrakResponse;
}

const L1_TO_EARTH_DISTANCE_KM = 1_500_000;
const REFRESH_INTERVAL_MS = 60_000;

const missionVariables = [
  {
    name: 'NOAA L1 Magnetometer',
    source: 'SWPC mag-2-hour',
    variables: ['time_tag', 'bx_gsm', 'by_gsm', 'bz_gsm', 'lon_gsm', 'lat_gsm', 'bt'],
  },
  {
    name: 'NOAA L1 Plasma',
    source: 'SWPC plasma-2-hour',
    variables: ['time_tag', 'density', 'speed', 'temperature'],
  },
  {
    name: 'NOAA L1 Ephemeris',
    source: 'SWPC ephemerides',
    variables: ['time_tag', 'x_gse', 'y_gse', 'z_gse', 'vx_gse', 'vy_gse', 'vz_gse'],
  },
  {
    name: 'NOAA Alerts',
    source: 'SWPC alerts',
    variables: ['product_id', 'issue_datetime', 'message'],
  },
  {
    name: 'CelesTrak Stations',
    source: 'TLE catalog',
    variables: ['name', 'line1', 'line2'],
  },
];

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

function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return 'Not available';
  }

  const date = new Date(value);

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
    timeZone: 'UTC',
  }) + ' UTC';
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

const StatusPill = ({ isConnected }: { isConnected: boolean }) => (
  <span
    className={`rounded border px-2 py-0.5 text-[9px] font-mono uppercase tracking-widest ${
      isConnected
        ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200'
        : 'border-slate-700 bg-slate-800/60 text-slate-500'
    }`}
  >
    {isConnected ? 'Live' : 'Off'}
  </span>
);

const MetricCard = ({ label, value }: { label: string; value: string }) => (
  <div className="min-w-0 rounded-md border border-slate-800 bg-slate-950/50 p-3">
    <div className="text-[10px] uppercase tracking-widest text-slate-500">{label}</div>
    <div className="mt-2 truncate font-mono text-sm text-slate-100">{value}</div>
  </div>
);

function TelemetryChart({ definition }: { definition: ChartDefinition }) {
  const chartData = useMemo(
    () =>
      definition.data.map((point) => ({
        time: point.time_tag
          ? new Date(point.time_tag).toLocaleTimeString('en-US', {
              hour: '2-digit',
              minute: '2-digit',
              hour12: false,
              timeZone: 'UTC',
            })
          : '',
        value: parseMetric(point[definition.dataKey]),
      })),
    [definition],
  );

  const hasData = definition.isConnected && chartData.some((point) => point.value !== null);

  return (
    <div className="min-h-[210px] rounded-lg border border-slate-800 bg-slate-950/60 p-3">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-xs font-semibold uppercase tracking-widest text-slate-300">
            {definition.title}
          </h3>
          <div className="mt-1 font-mono text-[10px] text-slate-500">{definition.unit}</div>
        </div>
        <StatusPill isConnected={definition.isConnected} />
      </div>

      {hasData ? (
        <div className="h-36 min-h-36">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
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
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="flex h-36 items-center justify-center rounded border border-slate-800 bg-slate-900/30">
          <span className="font-mono text-[10px] uppercase tracking-widest text-slate-600">
            Not available
          </span>
        </div>
      )}
    </div>
  );
}

export function PlaygroundDashboard({
  adminEmail,
  noaaMagData,
  noaaPlasmaData,
  noaaEphemerisData,
  noaaAlertsData,
  celestrakData,
}: PlaygroundDashboardProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    const refreshInterval = window.setInterval(() => {
      startTransition(() => {
        router.refresh();
      });
    }, REFRESH_INTERVAL_MS);

    return () => window.clearInterval(refreshInterval);
  }, [router]);

  const speedKmS = parseMetric(noaaPlasmaData.latestData?.speed);
  const eventTimestamp = noaaPlasmaData.latestData?.time_tag ?? noaaMagData.latestData?.time_tag ?? null;
  const travelSeconds = speedKmS ? L1_TO_EARTH_DISTANCE_KM / speedKmS : null;
  const arrivalTime =
    eventTimestamp && travelSeconds
      ? new Date(new Date(eventTimestamp).getTime() + travelSeconds * 1000).toISOString()
      : null;

  const chartDefinitions: ChartDefinition[] = [
    {
      title: 'Bt',
      unit: 'nT',
      dataKey: 'bt',
      color: '#38bdf8',
      data: noaaMagData.timeSeries,
      isConnected: noaaMagData.isConnected,
    },
    {
      title: 'Bx GSM',
      unit: 'nT',
      dataKey: 'bx_gsm',
      color: '#a78bfa',
      data: noaaMagData.timeSeries,
      isConnected: noaaMagData.isConnected,
    },
    {
      title: 'By GSM',
      unit: 'nT',
      dataKey: 'by_gsm',
      color: '#f472b6',
      data: noaaMagData.timeSeries,
      isConnected: noaaMagData.isConnected,
    },
    {
      title: 'Bz GSM',
      unit: 'nT',
      dataKey: 'bz_gsm',
      color: '#22d3ee',
      data: noaaMagData.timeSeries,
      isConnected: noaaMagData.isConnected,
    },
    {
      title: 'Speed',
      unit: 'km/s',
      dataKey: 'speed',
      color: '#fb7185',
      data: noaaPlasmaData.timeSeries,
      isConnected: noaaPlasmaData.isConnected,
    },
    {
      title: 'Density',
      unit: 'cm^-3',
      dataKey: 'density',
      color: '#34d399',
      data: noaaPlasmaData.timeSeries,
      isConnected: noaaPlasmaData.isConnected,
    },
    {
      title: 'Temperature',
      unit: 'K',
      dataKey: 'temperature',
      color: '#f59e0b',
      data: noaaPlasmaData.timeSeries,
      isConnected: noaaPlasmaData.isConnected,
    },
    {
      title: 'X GSE',
      unit: 'km',
      dataKey: 'x_gse',
      color: '#60a5fa',
      data: noaaEphemerisData.timeSeries,
      isConnected: noaaEphemerisData.isConnected,
    },
    {
      title: 'Y GSE',
      unit: 'km',
      dataKey: 'y_gse',
      color: '#c084fc',
      data: noaaEphemerisData.timeSeries,
      isConnected: noaaEphemerisData.isConnected,
    },
    {
      title: 'Z GSE',
      unit: 'km',
      dataKey: 'z_gse',
      color: '#2dd4bf',
      data: noaaEphemerisData.timeSeries,
      isConnected: noaaEphemerisData.isConnected,
    },
  ];

  const missionStatuses = [
    noaaMagData.isConnected,
    noaaPlasmaData.isConnected,
    noaaEphemerisData.isConnected,
    noaaAlertsData.isConnected,
    celestrakData.isConnected,
  ];

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
          <div className="hidden items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-slate-500 sm:flex">
            <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{formatDateTime(noaaPlasmaData.lastUpdated ?? noaaMagData.lastUpdated)}</span>
          </div>
          <button
            type="button"
            onClick={() => startTransition(() => router.refresh())}
            className="flex h-10 items-center gap-2 rounded-md border border-cyan-400/30 bg-cyan-400/10 px-3 text-sm text-cyan-100 transition hover:border-cyan-300/60 hover:bg-cyan-400/15 disabled:cursor-wait disabled:text-slate-500"
            disabled={isPending}
          >
            <RefreshCw className={`h-4 w-4 ${isPending ? 'animate-spin' : ''}`} aria-hidden="true" />
            <span>Refresh</span>
          </button>
        </div>
      </header>

      <main className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-y-auto pr-1 xl:grid-cols-[360px_minmax(0,1fr)]">
        <aside className="grid content-start gap-4">
          <section className="rounded-lg border border-slate-700/50 bg-slate-900/30 p-4 shadow-2xl backdrop-blur-xl">
            <div className="mb-3 flex items-center gap-2">
              <RadioTower className="h-4 w-4 text-cyan-300" aria-hidden="true" />
              <h2 className="text-xs font-semibold uppercase tracking-widest text-slate-300">
                Misiones
              </h2>
            </div>
            <div className="grid gap-2">
              {missionVariables.map((mission, index) => (
                <details
                  key={mission.name}
                  className="group rounded-md border border-slate-800 bg-slate-950/40 px-3 py-2"
                >
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
                    <span className="min-w-0">
                      <span className="block truncate text-sm text-slate-100">{mission.name}</span>
                      <span className="block truncate font-mono text-[10px] text-slate-500">
                        {mission.source}
                      </span>
                    </span>
                    <StatusPill isConnected={missionStatuses[index]} />
                  </summary>
                  <div className="mt-3 flex flex-wrap gap-1.5 border-t border-slate-800 pt-3">
                    {mission.variables.map((variable) => (
                      <span
                        key={variable}
                        className="rounded border border-slate-700 bg-slate-900 px-2 py-1 font-mono text-[10px] text-slate-300"
                      >
                        {variable}
                      </span>
                    ))}
                  </div>
                </details>
              ))}
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
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="text-xs font-semibold uppercase tracking-widest text-slate-300">
              Telemetry Plots
            </h2>
            <div className="font-mono text-[10px] uppercase tracking-widest text-slate-500">
              2H NOAA series
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 2xl:grid-cols-3">
            {chartDefinitions.map((definition) => (
              <TelemetryChart key={`${definition.dataKey}-${definition.title}`} definition={definition} />
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
