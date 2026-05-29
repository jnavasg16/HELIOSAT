"use client";

import { useMemo } from 'react';
import {
  AlertTriangle,
  ArrowRightLeft,
  Clock3,
  Gauge,
  Info,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Wind,
} from 'lucide-react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
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
import {
  NOMINAL_L1_DISTANCE_KM,
  classifyConditions,
  propagateL1Sample,
  propagateL1Series,
  type GeoeffectiveLevel,
  type L1Sample,
} from '@/services/mruForecastService';

interface MruLiveForecastPanelProps {
  plasmaData: NoaaServiceResponse<NoaaPlasmaData>;
  magData: NoaaServiceResponse<NoaaMagnetometerData>;
  ephemerisData: NoaaServiceResponse<NoaaEphemerisData>;
  isRefreshing: boolean;
  onRefresh: () => void;
}

const MIN_RELIABLE_L1_DISTANCE_KM = 500_000;
const MAX_RELIABLE_L1_DISTANCE_KM = 2_500_000;

function toNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatClock(ms: number | null) {
  if (ms === null) {
    return '--:--';
  }
  return new Date(ms).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'UTC',
  });
}

function formatRelativeMinutes(minutes: number | null) {
  if (minutes === null) {
    return '—';
  }
  if (minutes < 1) {
    return 'now';
  }
  return `${Math.round(minutes)} min`;
}

function getL1DistanceKm(ephemeris: NoaaEphemerisData | null): { km: number; isMeasured: boolean } {
  const x = toNumber(ephemeris?.x_gse);
  const y = toNumber(ephemeris?.y_gse);
  const z = toNumber(ephemeris?.z_gse);

  if (x === null || y === null || z === null) {
    return { km: NOMINAL_L1_DISTANCE_KM, isMeasured: false };
  }

  const distance = Math.sqrt(x * x + y * y + z * z);
  const isReliable = distance >= MIN_RELIABLE_L1_DISTANCE_KM && distance <= MAX_RELIABLE_L1_DISTANCE_KM;

  return isReliable ? { km: distance, isMeasured: true } : { km: NOMINAL_L1_DISTANCE_KM, isMeasured: false };
}

const LEVEL_STYLE: Record<GeoeffectiveLevel, { ring: string; chip: string; icon: typeof ShieldCheck }> = {
  quiet: { ring: 'border-emerald-400/30 bg-emerald-400/[0.07]', chip: 'border-emerald-400/40 bg-emerald-400/15 text-emerald-100', icon: ShieldCheck },
  unsettled: { ring: 'border-amber-300/30 bg-amber-300/[0.07]', chip: 'border-amber-300/40 bg-amber-300/15 text-amber-100', icon: ShieldAlert },
  storm: { ring: 'border-rose-400/30 bg-rose-400/[0.07]', chip: 'border-rose-400/40 bg-rose-400/15 text-rose-100', icon: ShieldAlert },
  unknown: { ring: 'border-slate-700 bg-slate-900/40', chip: 'border-slate-700 bg-slate-800/60 text-slate-400', icon: Info },
};

function StatRow({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="rounded-md border border-slate-800 bg-slate-950/50 p-3">
      <div className="font-mono text-[9px] uppercase tracking-widest text-slate-500">{label}</div>
      <div className="mt-1 flex items-baseline gap-1 font-mono">
        <span className="text-lg text-slate-100">{value}</span>
        {unit && <span className="text-[11px] text-slate-500">{unit}</span>}
      </div>
    </div>
  );
}

function ForecastChart({
  title,
  unit,
  color,
  points,
  nowMs,
}: {
  title: string;
  unit: string;
  color: string;
  points: Array<{ t: number; value: number | null }>;
  nowMs: number;
}) {
  const hasData = points.some(point => point.value !== null);
  const maxT = points.length > 0 ? points[points.length - 1].t : nowMs;

  return (
    <div className="min-h-[200px] rounded-lg border border-slate-800 bg-slate-950/60 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h4 className="text-xs font-semibold uppercase tracking-widest text-slate-300">{title}</h4>
        <span className="font-mono text-[10px] text-slate-500">{unit}</span>
      </div>
      {hasData ? (
        <div className="h-40 w-full">
          <ResponsiveContainer width="100%" height={160} minWidth={0} minHeight={160} initialDimension={{ width: 320, height: 160 }}>
            <LineChart data={points} margin={{ top: 6, right: 8, left: -18, bottom: 0 }}>
              <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" vertical={false} />
              {maxT > nowMs && (
                <ReferenceArea x1={nowMs} x2={maxT} fill="#22d3ee" fillOpacity={0.06} strokeOpacity={0} />
              )}
              <XAxis
                dataKey="t"
                type="number"
                domain={['dataMin', 'dataMax']}
                scale="time"
                fontSize={10}
                stroke="#64748b"
                tickMargin={6}
                minTickGap={28}
                tickFormatter={(value: number) => formatClock(value)}
              />
              <YAxis domain={['auto', 'auto']} fontSize={10} stroke="#64748b" tickFormatter={(value: number) => value.toFixed(1)} />
              <Tooltip
                contentStyle={{ backgroundColor: '#020617', border: '1px solid #334155', borderRadius: '6px', color: '#e2e8f0', fontSize: '12px' }}
                labelFormatter={value => `${formatClock(Number(value))} UTC`}
                formatter={value => [Number(value).toFixed(2), unit]}
              />
              <ReferenceLine x={nowMs} stroke="#22d3ee" strokeDasharray="4 3" strokeOpacity={0.7} />
              <Line dataKey="value" stroke={color} strokeWidth={1.7} dot={false} connectNulls isAnimationActive={false} type="linear" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="flex h-40 items-center justify-center font-mono text-[10px] uppercase tracking-widest text-slate-600">
          No live samples
        </div>
      )}
    </div>
  );
}

export function MruLiveForecastPanel({
  plasmaData,
  magData,
  ephemerisData,
  isRefreshing,
  onRefresh,
}: MruLiveForecastPanelProps) {
  const forecast = useMemo(() => {
    const distance = getL1DistanceKm(ephemerisData.latestData);

    const magByTime = new Map<string, NoaaMagnetometerData>();
    for (const sample of magData.timeSeries) {
      magByTime.set(sample.time_tag, sample);
    }

    const l1Samples: L1Sample[] = plasmaData.timeSeries.map(sample => {
      const mag = magByTime.get(sample.time_tag) ?? null;
      return {
        timeUtc: sample.time_tag,
        speedKmS: toNumber(sample.speed),
        densityPerCm3: toNumber(sample.density),
        temperatureK: toNumber(sample.temperature),
        bzNt: toNumber(mag?.bz_gsm),
        btNt: toNumber(mag?.bt),
      };
    });

    const propagated = propagateL1Series(l1Samples, distance.km);

    const latestPlasma = plasmaData.latestData;
    const latestMag = magData.latestData;
    const latestSpeed = toNumber(latestPlasma?.speed);
    const latestBz = toNumber(latestMag?.bz_gsm);
    const latestSample: L1Sample | null = latestPlasma
      ? {
          timeUtc: latestPlasma.time_tag,
          speedKmS: latestSpeed,
          densityPerCm3: toNumber(latestPlasma.density),
          temperatureK: toNumber(latestPlasma.temperature),
          bzNt: latestBz,
          btNt: toNumber(latestMag?.bt),
        }
      : null;
    const latestPropagated = latestSample ? propagateL1Sample(latestSample, distance.km) : null;

    return {
      distance,
      propagated,
      status: classifyConditions(latestSpeed, latestBz),
      latest: {
        speed: latestSpeed,
        density: toNumber(latestPlasma?.density),
        bz: latestBz,
        bt: toNumber(latestMag?.bt),
        sampleTimeMs: latestPlasma ? new Date(`${latestPlasma.time_tag.replace(' ', 'T')}Z`).getTime() : null,
      },
      lagMinutes: latestPropagated?.lagMinutes ?? null,
      arrivalMs: latestPropagated ? new Date(latestPropagated.arrivalTimeUtc).getTime() : null,
    };
  }, [plasmaData, magData, ephemerisData]);

  const speedPoints = forecast.propagated.map(sample => ({ t: new Date(sample.arrivalTimeUtc).getTime(), value: sample.speedKmS }));
  const bzPoints = forecast.propagated.map(sample => ({ t: new Date(sample.arrivalTimeUtc).getTime(), value: sample.bzNt }));
  // The boundary between "already reached Earth" and "still in transit" is the
  // arrival of the most recent L1 sample minus its lag, i.e. the sample time.
  // Deriving it from the data (not the wall clock) keeps render pure.
  const nowMs = forecast.latest.sampleTimeMs ?? (speedPoints.length > 0 ? speedPoints[speedPoints.length - 1].t : 0);
  const style = LEVEL_STYLE[forecast.status.level];
  const StatusIcon = style.icon;
  const hasForecast = forecast.propagated.length > 0;

  return (
    <main className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pr-1">
      {/* Status banner */}
      <section className={`rounded-lg border p-5 shadow-2xl backdrop-blur-xl ${style.ring}`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border ${style.chip}`}>
              <StatusIcon className="h-6 w-6" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className={`inline-flex items-center rounded border px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest ${style.chip}`}>
                  {forecast.status.label}
                </span>
                <span className="font-mono text-[10px] uppercase tracking-widest text-slate-500">MRU baseline · live</span>
              </div>
              <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-slate-200">{forecast.status.headline}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onRefresh}
            disabled={isRefreshing}
            className="flex h-10 items-center gap-2 rounded-md border border-cyan-400/30 bg-cyan-400/10 px-3 text-sm text-cyan-100 transition hover:border-cyan-300/60 hover:bg-cyan-400/15 disabled:cursor-wait disabled:text-slate-500"
          >
            <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} aria-hidden="true" />
            <span>{isRefreshing ? 'Syncing' : 'Refresh'}</span>
          </button>
        </div>
      </section>

      {/* Arrival headline */}
      <section className="rounded-lg border border-slate-700/50 bg-slate-900/30 p-5 shadow-2xl backdrop-blur-xl">
        <div className="flex items-center gap-2">
          <ArrowRightLeft className="h-4 w-4 shrink-0 text-cyan-300" aria-hidden="true" />
          <h2 className="text-xs font-semibold uppercase tracking-widest text-slate-300">L1 → Earth right now</h2>
        </div>
        <p className="mt-3 text-sm leading-relaxed text-slate-300">
          {hasForecast ? (
            <>
              Solar wind measured at L1 is travelling at{' '}
              <span className="font-mono text-cyan-200">{forecast.latest.speed !== null ? Math.round(forecast.latest.speed) : '—'} km/s</span>. At
              that speed it crosses the{' '}
              <span className="font-mono text-cyan-200">{(forecast.distance.km / 1_000_000).toFixed(2)}M km</span> to Earth in about{' '}
              <span className="font-mono text-cyan-200">{formatRelativeMinutes(forecast.lagMinutes)}</span>
              {forecast.arrivalMs !== null && (
                <> — arriving near <span className="font-mono text-cyan-200">{formatClock(forecast.arrivalMs)} UTC</span></>
              )}
              .
            </>
          ) : (
            'Waiting for a valid L1 solar-wind speed to compute the propagation.'
          )}
        </p>

        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <StatRow label="Speed" value={forecast.latest.speed !== null ? Math.round(forecast.latest.speed).toString() : '—'} unit="km/s" />
          <StatRow label="Density" value={forecast.latest.density !== null ? forecast.latest.density.toFixed(1) : '—'} unit="n/cc" />
          <StatRow label="Bz (GSM)" value={forecast.latest.bz !== null ? forecast.latest.bz.toFixed(1) : '—'} unit="nT" />
          <StatRow label="|B|" value={forecast.latest.bt !== null ? forecast.latest.bt.toFixed(1) : '—'} unit="nT" />
          <StatRow label="Transit lag" value={formatRelativeMinutes(forecast.lagMinutes)} />
          <StatRow label="Arrival" value={forecast.arrivalMs !== null ? `${formatClock(forecast.arrivalMs)} UTC` : '—'} />
        </div>

        <div className="mt-3 flex items-start gap-2 rounded-md border border-slate-800 bg-slate-950/40 p-3 text-xs leading-relaxed text-slate-400">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-cyan-300/70" aria-hidden="true" />
          <span>
            The shaded band on the charts is the genuine forecast: solar wind already measured at L1 but{' '}
            <span className="text-slate-200">not yet arrived</span> — your free lead time.{' '}
            {forecast.distance.isMeasured
              ? 'L1 distance is from live spacecraft ephemeris.'
              : `L1 distance uses the nominal ${(NOMINAL_L1_DISTANCE_KM / 1_000_000).toFixed(1)}M km (live ephemeris unavailable).`}
          </span>
        </div>
      </section>

      {/* Forecast charts */}
      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-slate-700/50 bg-slate-900/30 p-4 shadow-2xl backdrop-blur-xl">
          <div className="mb-2 flex items-center gap-2">
            <Wind className="h-4 w-4 text-cyan-300" aria-hidden="true" />
            <h3 className="text-xs font-semibold uppercase tracking-widest text-slate-300">Speed → Earth</h3>
          </div>
          <ForecastChart title="Predicted at Earth" unit="km/s" color="#38bdf8" points={speedPoints} nowMs={nowMs} />
        </div>
        <div className="rounded-lg border border-slate-700/50 bg-slate-900/30 p-4 shadow-2xl backdrop-blur-xl">
          <div className="mb-2 flex items-center gap-2">
            <Gauge className="h-4 w-4 text-cyan-300" aria-hidden="true" />
            <h3 className="text-xs font-semibold uppercase tracking-widest text-slate-300">Bz → Earth</h3>
          </div>
          <ForecastChart title="Predicted at Earth" unit="nT" color="#c084fc" points={bzPoints} nowMs={nowMs} />
        </div>
      </section>

      {(!plasmaData.isConnected || !magData.isConnected) && (
        <div className="flex items-center gap-2 rounded-md border border-amber-300/25 bg-amber-300/10 px-3 py-2 text-xs text-amber-100/90">
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>Live L1 feed is degraded — the forecast uses the most recent samples available.</span>
        </div>
      )}

      <div className="flex items-center gap-1.5 px-1 font-mono text-[10px] uppercase tracking-widest text-slate-600">
        <Clock3 className="h-3 w-3" aria-hidden="true" />
        <span>Times in UTC · decision support only</span>
      </div>
    </main>
  );
}
