import { NextResponse } from 'next/server';
import { getCurrentAdminState } from '@/lib/supabase/admin';
import {
  buildDataQualitySnapshot,
  buildNormalizedRowsFromTelemetry,
} from '@/services/dataQualityService';
import { buildFeatureWorkbenchSnapshot } from '@/services/featureEngineeringService';
import { buildL1EarthCouplingSnapshot } from '@/services/l1EarthCouplingService';
import { buildLiveForecastSnapshot, type LiveForecastSnapshot } from '@/services/liveForecastService';
import { buildBaselinesLabSnapshot } from '@/services/modelBenchmarkService';
import { fetchGoesMagnetometerRows } from '@/services/noaaGoesMagnetometerService';
import { buildPipelineHealthSnapshot } from '@/services/pipelineHealthService';
import { fetchPlaygroundTelemetry } from '@/services/playgroundTelemetryService';
import { fetchContextIndexSnapshot } from '@/services/spaceWeatherContextIndexService';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const CACHE_TTL_MS = 60 * 1000;

let cachedResponse: {
  expiresAt: number;
  snapshot: LiveForecastSnapshot;
} | null = null;

export async function GET() {
  const adminState = await getCurrentAdminState();

  if (!adminState.isAdmin) {
    return NextResponse.json(
      { error: 'Admin required' },
      {
        status: 403,
        headers: {
          'Cache-Control': 'no-store',
        },
      },
    );
  }

  if (cachedResponse && Date.now() < cachedResponse.expiresAt) {
    return NextResponse.json(cachedResponse.snapshot, {
      headers: {
        'Cache-Control': 'no-store',
      },
    });
  }

  const [telemetry, goesMag, context] = await Promise.all([
    fetchPlaygroundTelemetry(),
    fetchGoesMagnetometerRows(),
    fetchContextIndexSnapshot(),
  ]);
  const telemetryRows = buildNormalizedRowsFromTelemetry(telemetry);
  const qualitySnapshot = buildDataQualitySnapshot(telemetry);
  const cleanTimestampBySeries = new Map(
    qualitySnapshot.cleanTimestampExport.perSeries.map(series => [series.seriesId, new Set(series.timestamps)]),
  );
  const rows = [
    ...telemetryRows.filter(row => cleanTimestampBySeries.get(`${row.source}:${row.variable}`)?.has(row.timestamp_utc) ?? false),
    ...goesMag.rows,
  ];
  const couplingSnapshot = buildL1EarthCouplingSnapshot(rows);
  const featureSnapshot = buildFeatureWorkbenchSnapshot(rows, couplingSnapshot, context);
  const baselinesSnapshot = buildBaselinesLabSnapshot(featureSnapshot);
  const pipelineHealth = buildPipelineHealthSnapshot(telemetry);
  const snapshot = buildLiveForecastSnapshot(featureSnapshot, baselinesSnapshot, pipelineHealth);

  if (goesMag.errorMessage) {
    snapshot.warnings.push(`GOES MAG fetch: ${goesMag.errorMessage}`);
  }

  cachedResponse = {
    expiresAt: Date.now() + CACHE_TTL_MS,
    snapshot,
  };

  return NextResponse.json(snapshot, {
    headers: {
      'Cache-Control': 'no-store',
    },
  });
}
