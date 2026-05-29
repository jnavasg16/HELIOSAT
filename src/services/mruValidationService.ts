/**
 * MRU validation: backtest the uniform-rectilinear-motion baseline against
 * reality on a historical window.
 *
 *   L1 input  : ACE key-parameter feeds (solar wind measured at L1)
 *   Earth truth: OMNI HRO 1-min (the community-standard solar wind propagated
 *                to Earth's bow shock nose)
 *
 * We propagate the ACE samples to Earth with the MRU rule and compare the
 * result against OMNI on a common time grid. Speed, density and |B| are
 * frame-independent and are scored; Bz is shown for context only (ACE reports
 * GSE here, OMNI reports GSM, so a direct error would mix in a frame rotation).
 */
import { fetchHapiSeries, toFiniteNumber, type HapiSeriesResult } from './historicPlotService';
import {
  NOMINAL_L1_DISTANCE_KM,
  propagateL1Series,
  type L1Sample,
  type PropagatedSample,
} from './mruForecastService';

export type ScoredVariableId = 'speed' | 'density' | 'bt';
export type SeriesVariableId = ScoredVariableId | 'bz';

export interface MruValidationMetric {
  variableId: ScoredVariableId;
  label: string;
  unit: string;
  count: number;
  mae: number | null;
  rmse: number | null;
  bias: number | null;
  truthMean: number | null;
  relativeMaePct: number | null;
}

export interface MruValidationPoint {
  timeUtc: string;
  value: number | null;
}

export interface MruValidationSeries {
  variableId: SeriesVariableId;
  label: string;
  unit: string;
  l1: MruValidationPoint[];
  predicted: MruValidationPoint[];
  truth: MruValidationPoint[];
  note?: string;
}

export interface MruValidationSnapshot {
  generatedAtUtc: string;
  range: { startUtc: string; stopUtc: string };
  l1Source: string;
  truthSource: string;
  distanceKm: number;
  meanLagMinutes: number | null;
  sampleCount: { l1: number; truth: number; matched: number };
  metrics: MruValidationMetric[];
  series: MruValidationSeries[];
  warnings: string[];
}

const MAX_SERIES_POINTS = 320;
const PLASMA_MAG_JOIN_TOLERANCE_MS = 120_000;
const PREDICTED_TRUTH_JOIN_TOLERANCE_MS = 90_000;

const PHYSICAL_RANGE: Record<SeriesVariableId, { min: number; max: number }> = {
  speed: { min: 100, max: 3000 },
  density: { min: 0.01, max: 200 },
  bt: { min: 0, max: 200 },
  bz: { min: -200, max: 200 },
};

function parseTimeMs(value: unknown): number | null {
  if (typeof value !== 'string') {
    return null;
  }

  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? null : ms;
}

function sanitize(value: number | null, variableId: SeriesVariableId): number | null {
  if (value === null) {
    return null;
  }

  const { min, max } = PHYSICAL_RANGE[variableId];
  return value >= min && value <= max ? value : null;
}

/** Read a possibly-vector HAPI cell (e.g. ACE BGSEc => [bx, by, bz]). */
function readVectorComponent(cell: unknown, index: number): number | null {
  return Array.isArray(cell) ? toFiniteNumber(cell[index]) : null;
}

type TimedItem<T> = { ms: number; item: T };

/** Nearest-neighbour join of two ascending-by-time series within a tolerance. */
function joinNearest<TA, TB>(
  a: TimedItem<TA>[],
  b: TimedItem<TB>[],
  toleranceMs: number,
): Array<{ a: TA; b: TB }> {
  if (a.length === 0 || b.length === 0) {
    return [];
  }

  const matches: Array<{ a: TA; b: TB }> = [];
  let j = 0;

  for (const entry of a) {
    while (j + 1 < b.length && Math.abs(b[j + 1].ms - entry.ms) <= Math.abs(b[j].ms - entry.ms)) {
      j += 1;
    }

    if (Math.abs(b[j].ms - entry.ms) <= toleranceMs) {
      matches.push({ a: entry.item, b: b[j].item });
    }
  }

  return matches;
}

function downsample<T>(points: T[], maxPoints = MAX_SERIES_POINTS): T[] {
  if (points.length <= maxPoints) {
    return points;
  }

  const stride = Math.ceil(points.length / maxPoints);
  return points.filter((_, index) => index % stride === 0);
}

function computeMetric(
  variableId: ScoredVariableId,
  label: string,
  unit: string,
  pairs: Array<{ predicted: number | null; truth: number | null }>,
): MruValidationMetric {
  const valid = pairs.filter(
    (pair): pair is { predicted: number; truth: number } =>
      pair.predicted !== null && pair.truth !== null,
  );
  const count = valid.length;

  if (count === 0) {
    return { variableId, label, unit, count: 0, mae: null, rmse: null, bias: null, truthMean: null, relativeMaePct: null };
  }

  let sumAbs = 0;
  let sumSq = 0;
  let sumResidual = 0;
  let sumTruth = 0;

  for (const { predicted, truth } of valid) {
    const residual = predicted - truth;
    sumAbs += Math.abs(residual);
    sumSq += residual * residual;
    sumResidual += residual;
    sumTruth += truth;
  }

  const mae = sumAbs / count;
  const truthMean = sumTruth / count;

  return {
    variableId,
    label,
    unit,
    count,
    mae,
    rmse: Math.sqrt(sumSq / count),
    bias: sumResidual / count,
    truthMean,
    relativeMaePct: truthMean !== 0 ? (mae / Math.abs(truthMean)) * 100 : null,
  };
}

function toPoint(ms: number, value: number | null): MruValidationPoint {
  return { timeUtc: new Date(ms).toISOString(), value };
}

export async function buildMruValidationSnapshot(range: {
  startUtc: string;
  stopUtc: string;
}): Promise<MruValidationSnapshot> {
  const generatedAtUtc = new Date().toISOString();
  const warnings: string[] = [];
  const l1Source = 'ACE key parameters (CDAWeb HAPI)';
  const truthSource = 'OMNI HRO 1-min (CDAWeb HAPI)';

  const base: MruValidationSnapshot = {
    generatedAtUtc,
    range,
    l1Source,
    truthSource,
    distanceKm: NOMINAL_L1_DISTANCE_KM,
    meanLagMinutes: null,
    sampleCount: { l1: 0, truth: 0, matched: 0 },
    metrics: [],
    series: [],
    warnings,
  };

  const startMs = parseTimeMs(range.startUtc);
  const stopMs = parseTimeMs(range.stopUtc);

  if (startMs === null || stopMs === null || stopMs <= startMs) {
    warnings.push('Invalid time range: choose a start before the stop.');
    return base;
  }

  const [plasmaResult, magResult, omniResult]: HapiSeriesResult[] = await Promise.all([
    fetchHapiSeries('AC_K0_SWE', ['Np', 'Vp', 'Tpr'], range),
    fetchHapiSeries('AC_K0_MFI', ['Magnitude', 'BGSEc'], range),
    fetchHapiSeries('OMNI_HRO_1MIN', ['F', 'BZ_GSM', 'flow_speed', 'proton_density'], range),
  ]);

  warnings.push(...plasmaResult.warnings, ...magResult.warnings, ...omniResult.warnings);

  // --- L1 input: join ACE plasma (Np, Vp) with ACE magnetometer (|B|, Bz GSE) ---
  const plasmaPoints: TimedItem<{ speed: number | null; density: number | null; temp: number | null }>[] =
    plasmaResult.rows
      .map(row => {
        const ms = parseTimeMs(row[0]);
        if (ms === null) {
          return null;
        }
        return {
          ms,
          item: {
            density: sanitize(toFiniteNumber(row[1]), 'density'),
            speed: sanitize(toFiniteNumber(row[2]), 'speed'),
            temp: toFiniteNumber(row[3]),
          },
        };
      })
      .filter((entry): entry is TimedItem<{ speed: number | null; density: number | null; temp: number | null }> => entry !== null)
      .sort((a, b) => a.ms - b.ms);

  const magPoints: TimedItem<{ bt: number | null; bz: number | null }>[] = magResult.rows
    .map(row => {
      const ms = parseTimeMs(row[0]);
      if (ms === null) {
        return null;
      }
      return {
        ms,
        item: {
          bt: sanitize(toFiniteNumber(row[1]), 'bt'),
          bz: sanitize(readVectorComponent(row[2], 2), 'bz'),
        },
      };
    })
    .filter((entry): entry is TimedItem<{ bt: number | null; bz: number | null }> => entry !== null)
    .sort((a, b) => a.ms - b.ms);

  const l1Samples: L1Sample[] = plasmaPoints
    .map(plasma => {
      // attach nearest magnetometer reading
      const joined = joinNearest([plasma], magPoints, PLASMA_MAG_JOIN_TOLERANCE_MS)[0];
      return {
        timeUtc: new Date(plasma.ms).toISOString(),
        speedKmS: plasma.item.speed,
        densityPerCm3: plasma.item.density,
        temperatureK: plasma.item.temp,
        btNt: joined?.b.bt ?? null,
        bzNt: joined?.b.bz ?? null,
      } satisfies L1Sample;
    })
    .filter(sample => sample.speedKmS !== null);

  const predicted: PropagatedSample[] = propagateL1Series(l1Samples, NOMINAL_L1_DISTANCE_KM);

  // --- Earth truth: OMNI ---
  const truthPoints = omniResult.rows
    .map(row => {
      const ms = parseTimeMs(row[0]);
      if (ms === null) {
        return null;
      }
      return {
        ms,
        bt: sanitize(toFiniteNumber(row[1]), 'bt'),
        bz: sanitize(toFiniteNumber(row[2]), 'bz'),
        speed: sanitize(toFiniteNumber(row[3]), 'speed'),
        density: sanitize(toFiniteNumber(row[4]), 'density'),
      };
    })
    .filter((entry): entry is { ms: number; bt: number | null; bz: number | null; speed: number | null; density: number | null } => entry !== null)
    .sort((a, b) => a.ms - b.ms);

  if (predicted.length === 0 || truthPoints.length === 0) {
    if (predicted.length === 0) {
      warnings.push('No usable ACE solar-wind samples for this window.');
    }
    if (truthPoints.length === 0) {
      warnings.push('No usable OMNI samples for this window.');
    }
    return {
      ...base,
      sampleCount: { l1: predicted.length, truth: truthPoints.length, matched: 0 },
    };
  }

  // --- Align MRU prediction (by arrival time) with OMNI truth (by time) ---
  const predictedTimed: TimedItem<PropagatedSample>[] = predicted.map(sample => ({
    ms: new Date(sample.arrivalTimeUtc).getTime(),
    item: sample,
  }));
  const truthTimed: TimedItem<(typeof truthPoints)[number]>[] = truthPoints.map(point => ({
    ms: point.ms,
    item: point,
  }));

  const matched = joinNearest(truthTimed, predictedTimed, PREDICTED_TRUTH_JOIN_TOLERANCE_MS);

  const metrics: MruValidationMetric[] = [
    computeMetric('speed', 'Solar-wind speed', 'km/s', matched.map(m => ({ predicted: m.b.speedKmS, truth: m.a.speed }))),
    computeMetric('density', 'Proton density', 'n/cc', matched.map(m => ({ predicted: m.b.densityPerCm3, truth: m.a.density }))),
    computeMetric('bt', 'Field magnitude |B|', 'nT', matched.map(m => ({ predicted: m.b.btNt, truth: m.a.bt }))),
  ];

  const meanLagMinutes = predicted.reduce((sum, sample) => sum + sample.lagMinutes, 0) / predicted.length;

  const series: MruValidationSeries[] = [
    {
      variableId: 'speed',
      label: 'Solar-wind speed',
      unit: 'km/s',
      l1: downsample(l1Samples.map(s => toPoint(new Date(s.timeUtc).getTime(), s.speedKmS))),
      predicted: downsample(predicted.map(s => toPoint(new Date(s.arrivalTimeUtc).getTime(), s.speedKmS))),
      truth: downsample(truthPoints.map(p => toPoint(p.ms, p.speed))),
    },
    {
      variableId: 'density',
      label: 'Proton density',
      unit: 'n/cc',
      l1: downsample(l1Samples.map(s => toPoint(new Date(s.timeUtc).getTime(), s.densityPerCm3))),
      predicted: downsample(predicted.map(s => toPoint(new Date(s.arrivalTimeUtc).getTime(), s.densityPerCm3))),
      truth: downsample(truthPoints.map(p => toPoint(p.ms, p.density))),
    },
    {
      variableId: 'bt',
      label: 'Field magnitude |B|',
      unit: 'nT',
      l1: downsample(l1Samples.map(s => toPoint(new Date(s.timeUtc).getTime(), s.btNt))),
      predicted: downsample(predicted.map(s => toPoint(new Date(s.arrivalTimeUtc).getTime(), s.btNt))),
      truth: downsample(truthPoints.map(p => toPoint(p.ms, p.bt))),
    },
    {
      variableId: 'bz',
      label: 'Bz (north-south field)',
      unit: 'nT',
      note: 'Shown for context only — ACE reports Bz in GSE here while OMNI reports GSM, so this is not scored.',
      l1: downsample(l1Samples.map(s => toPoint(new Date(s.timeUtc).getTime(), s.bzNt))),
      predicted: downsample(predicted.map(s => toPoint(new Date(s.arrivalTimeUtc).getTime(), s.bzNt))),
      truth: downsample(truthPoints.map(p => toPoint(p.ms, p.bz))),
    },
  ];

  return {
    ...base,
    meanLagMinutes,
    sampleCount: { l1: predicted.length, truth: truthPoints.length, matched: matched.length },
    metrics,
    series,
    warnings,
  };
}
