export interface HistoricPlotRange {
  startUtc: string;
  stopUtc: string;
}

export interface HistoricPlotPoint {
  time_tag: string;
  value: string | number | null;
}

export interface HistoricPlotChart {
  id: string;
  sourceId: string;
  spacecraftName: string;
  source: string;
  title: string;
  unit: string;
  color: string;
  lastSampleTime: string | null;
  data: HistoricPlotPoint[];
}

export interface HistoricPlotsSnapshot {
  generatedAtUtc: string;
  range: HistoricPlotRange;
  requestedSourceIds: string[];
  charts: HistoricPlotChart[];
  warnings: string[];
  unsupportedSourceIds: string[];
}

interface HapiInfoResponse {
  startDate?: string;
  stopDate?: string;
  status?: {
    code: number;
    message: string;
  };
}

interface HapiDataResponse {
  data?: unknown[][];
  status?: {
    code: number;
    message: string;
  };
}

interface HapiSeriesResult {
  rows: unknown[][];
  warnings: string[];
}

interface GoesScalarPoint {
  time_tag?: string;
  satellite?: number | string;
  flux?: number | string | null;
  energy?: string;
}

interface GoesMagPoint extends GoesScalarPoint {
  He?: number | string | null;
  Hp?: number | string | null;
  Hn?: number | string | null;
  total?: number | string | null;
}

type GoesRole = 'primary' | 'secondary';

const HAPI_BASE_URL = 'https://cdaweb.gsfc.nasa.gov/hapi';
const SWPC_GOES_BASE_URL = 'https://services.swpc.noaa.gov/json/goes';
const REQUEST_TIMEOUT_MS = 8000;
const MAX_RETRIES = 2;
const RETRY_BASE_DELAY_MS = 350;
const MAX_POINTS_PER_CHART = 240;
const MAX_HAPI_PREVIEW_RANGE_MS = 31 * 24 * 60 * 60 * 1000;
const MAX_GOES_PREVIEW_RANGE_MS = 7 * 24 * 60 * 60 * 1000;

const COLOR = {
  bt: '#38bdf8',
  bx: '#a78bfa',
  by: '#f472b6',
  bz: '#22d3ee',
  speed: '#fb7185',
  density: '#34d399',
  temperature: '#f59e0b',
  x: '#60a5fa',
  y: '#c084fc',
  z: '#2dd4bf',
  electron: '#34d399',
  proton: '#fb7185',
  xrs: '#f59e0b',
};

const PLOT_READY_SOURCE_IDS = new Set([
  'cdaweb-ace-wind-imap',
  'omni-hro',
  'swpc-goes-json',
]);

function sleep(delayMs: number) {
  return new Promise(resolve => setTimeout(resolve, delayMs));
}

function parseTimestampMs(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const normalized = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(value)
    ? value
    : `${value.replace(' ', 'T')}Z`;
  const parsed = new Date(normalized).getTime();

  return Number.isNaN(parsed) ? null : parsed;
}

function toIsoUtc(timestampMs: number) {
  return new Date(timestampMs).toISOString();
}

function normalizeRange(range: HistoricPlotRange): HistoricPlotRange | null {
  const startMs = parseTimestampMs(range.startUtc);
  const stopMs = parseTimestampMs(range.stopUtc);

  if (startMs === null || stopMs === null || stopMs <= startMs) {
    return null;
  }

  return {
    startUtc: toIsoUtc(startMs),
    stopUtc: toIsoUtc(stopMs),
  };
}

function clampRangeToMaxDuration(range: HistoricPlotRange, maxDurationMs: number) {
  const startMs = parseTimestampMs(range.startUtc) ?? 0;
  const stopMs = parseTimestampMs(range.stopUtc) ?? startMs;

  if (stopMs - startMs <= maxDurationMs) {
    return { range, clamped: false };
  }

  return {
    range: {
      startUtc: toIsoUtc(stopMs - maxDurationMs),
      stopUtc: range.stopUtc,
    },
    clamped: true,
  };
}

function toFiniteNumber(value: unknown) {
  if (typeof value === 'number') {
    return Number.isFinite(value) && Math.abs(value) < 1e30 ? value : null;
  }

  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) && Math.abs(parsed) < 1e30 ? parsed : null;
  }

  return null;
}

function vectorComponent(value: unknown, index: number) {
  return Array.isArray(value) ? toFiniteNumber(value[index]) : null;
}

function vectorMagnitude(value: unknown) {
  if (!Array.isArray(value)) {
    return null;
  }

  const components = value.map(toFiniteNumber);

  if (components.some(component => component === null)) {
    return null;
  }

  return Math.sqrt(
    components.reduce<number>((sum, component) => sum + (component ?? 0) ** 2, 0),
  );
}

function downsample<T>(rows: T[], maxPoints = MAX_POINTS_PER_CHART) {
  if (rows.length <= maxPoints) {
    return rows;
  }

  const step = Math.ceil(rows.length / maxPoints);

  return rows.filter((_, index) => index % step === 0 || index === rows.length - 1);
}

async function fetchJsonWithRetry(url: string): Promise<unknown> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        cache: 'no-store',
        signal: abortController.signal,
      });

      if (!response.ok) {
        throw new Error(`Request failed with ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('Request failed');

      if (attempt < MAX_RETRIES) {
        await sleep(RETRY_BASE_DELAY_MS * 2 ** attempt);
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError ?? new Error('Request failed');
}

async function fetchHapiSeries(
  datasetId: string,
  parameters: string[],
  range: HistoricPlotRange,
): Promise<HapiSeriesResult> {
  const warnings: string[] = [];

  try {
    const infoUrl = new URL(`${HAPI_BASE_URL}/info`);
    infoUrl.searchParams.set('id', datasetId);
    const info = await fetchJsonWithRetry(infoUrl.toString()) as HapiInfoResponse;

    if (info.status && info.status.code !== 1200) {
      return {
        rows: [],
        warnings: [`${datasetId}: ${info.status.message}`],
      };
    }

    const requestedStartMs = parseTimestampMs(range.startUtc) ?? 0;
    const requestedStopMs = parseTimestampMs(range.stopUtc) ?? requestedStartMs;
    const datasetStartMs = parseTimestampMs(info.startDate) ?? requestedStartMs;
    const datasetStopMs = parseTimestampMs(info.stopDate) ?? requestedStopMs;
    const startMs = Math.max(requestedStartMs, datasetStartMs);
    const stopMs = Math.min(requestedStopMs, datasetStopMs);

    if (stopMs <= startMs) {
      return {
        rows: [],
        warnings: [`${datasetId}: no catalog coverage for selected range.`],
      };
    }

    if (stopMs < requestedStopMs) {
      warnings.push(`${datasetId}: data stop is ${toIsoUtc(stopMs)}; selected range was clipped.`);
    }

    const dataUrl = new URL(`${HAPI_BASE_URL}/data`);
    dataUrl.searchParams.set('id', datasetId);
    dataUrl.searchParams.set('parameters', parameters.join(','));
    dataUrl.searchParams.set('time.min', toIsoUtc(startMs));
    dataUrl.searchParams.set('time.max', toIsoUtc(stopMs));
    dataUrl.searchParams.set('format', 'json');

    const data = await fetchJsonWithRetry(dataUrl.toString()) as HapiDataResponse;

    if (data.status && data.status.code !== 1200) {
      return {
        rows: [],
        warnings: [`${datasetId}: ${data.status.message}`],
      };
    }

    return {
      rows: data.data ?? [],
      warnings,
    };
  } catch (error) {
    return {
      rows: [],
      warnings: [error instanceof Error ? `${datasetId}: ${error.message}` : `${datasetId}: HAPI request failed`],
    };
  }
}

function buildHapiChart(
  id: string,
  sourceId: string,
  spacecraftName: string,
  source: string,
  title: string,
  unit: string,
  color: string,
  rows: unknown[][],
  getValue: (row: unknown[]) => number | null,
): HistoricPlotChart | null {
  const data = downsample(rows)
    .map(row => {
      const timestampMs = typeof row[0] === 'string' ? parseTimestampMs(row[0]) : null;

      return {
        time_tag: timestampMs === null ? '' : toIsoUtc(timestampMs),
        value: getValue(row),
      };
    })
    .filter(point => point.time_tag);

  if (data.length === 0) {
    return null;
  }

  return {
    id,
    sourceId,
    spacecraftName,
    source,
    title,
    unit,
    color,
    lastSampleTime: data[data.length - 1]?.time_tag ?? null,
    data,
  };
}

async function buildCdawebAceWindImapCharts(range: HistoricPlotRange) {
  const warnings: string[] = [];
  const charts: HistoricPlotChart[] = [];

  const [
    aceMag,
    acePlasma,
    windMag,
    windPlasma,
    imapMag,
    imapSwapi,
  ] = await Promise.all([
    fetchHapiSeries('AC_K0_MFI', ['Magnitude', 'BGSEc'], range),
    fetchHapiSeries('AC_K0_SWE', ['Np', 'Vp', 'Tpr'], range),
    fetchHapiSeries('WI_K0_MFI', ['BF1', 'BGSMc', 'PGSE'], range),
    fetchHapiSeries('WI_K0_SWE', ['SC_pos_gse', 'V_GSE', 'THERMAL_SPD', 'Np'], range),
    fetchHapiSeries('IMAP_IALIRT_L1_REALTIME@1', ['mag_B_magnitude', 'mag_B_GSM'], range),
    fetchHapiSeries('IMAP_IALIRT_L1_REALTIME@2', [
      'swapi_pseudo_proton_density',
      'swapi_pseudo_proton_speed',
      'swapi_pseudo_proton_temperature',
    ], range),
  ]);

  warnings.push(
    ...aceMag.warnings,
    ...acePlasma.warnings,
    ...windMag.warnings,
    ...windPlasma.warnings,
    ...imapMag.warnings,
    ...imapSwapi.warnings,
  );

  [
    buildHapiChart('historic-ace-bt', 'cdaweb-ace-wind-imap', 'ACE', 'NASA CDAWeb HAPI', 'ACE BT', 'nT', COLOR.bt, aceMag.rows, row => toFiniteNumber(row[1])),
    buildHapiChart('historic-ace-bx-gse', 'cdaweb-ace-wind-imap', 'ACE', 'NASA CDAWeb HAPI', 'ACE Bx GSE', 'nT', COLOR.bx, aceMag.rows, row => vectorComponent(row[2], 0)),
    buildHapiChart('historic-ace-by-gse', 'cdaweb-ace-wind-imap', 'ACE', 'NASA CDAWeb HAPI', 'ACE By GSE', 'nT', COLOR.by, aceMag.rows, row => vectorComponent(row[2], 1)),
    buildHapiChart('historic-ace-bz-gse', 'cdaweb-ace-wind-imap', 'ACE', 'NASA CDAWeb HAPI', 'ACE Bz GSE', 'nT', COLOR.bz, aceMag.rows, row => vectorComponent(row[2], 2)),
    buildHapiChart('historic-ace-density', 'cdaweb-ace-wind-imap', 'ACE', 'NASA CDAWeb HAPI', 'ACE density', 'cm^-3', COLOR.density, acePlasma.rows, row => toFiniteNumber(row[1])),
    buildHapiChart('historic-ace-speed', 'cdaweb-ace-wind-imap', 'ACE', 'NASA CDAWeb HAPI', 'ACE speed', 'km/s', COLOR.speed, acePlasma.rows, row => toFiniteNumber(row[2])),
    buildHapiChart('historic-wind-bt', 'cdaweb-ace-wind-imap', 'WIND', 'NASA CDAWeb HAPI', 'WIND BT', 'nT', COLOR.bt, windMag.rows, row => toFiniteNumber(row[1])),
    buildHapiChart('historic-wind-bx-gsm', 'cdaweb-ace-wind-imap', 'WIND', 'NASA CDAWeb HAPI', 'WIND Bx GSM', 'nT', COLOR.bx, windMag.rows, row => vectorComponent(row[2], 0)),
    buildHapiChart('historic-wind-by-gsm', 'cdaweb-ace-wind-imap', 'WIND', 'NASA CDAWeb HAPI', 'WIND By GSM', 'nT', COLOR.by, windMag.rows, row => vectorComponent(row[2], 1)),
    buildHapiChart('historic-wind-bz-gsm', 'cdaweb-ace-wind-imap', 'WIND', 'NASA CDAWeb HAPI', 'WIND Bz GSM', 'nT', COLOR.bz, windMag.rows, row => vectorComponent(row[2], 2)),
    buildHapiChart('historic-wind-speed', 'cdaweb-ace-wind-imap', 'WIND', 'NASA CDAWeb HAPI', 'WIND speed', 'km/s', COLOR.speed, windPlasma.rows, row => vectorMagnitude(row[2])),
    buildHapiChart('historic-wind-density', 'cdaweb-ace-wind-imap', 'WIND', 'NASA CDAWeb HAPI', 'WIND density', 'cm^-3', COLOR.density, windPlasma.rows, row => toFiniteNumber(row[4])),
    buildHapiChart('historic-imap-bt', 'cdaweb-ace-wind-imap', 'IMAP', 'NASA CDAWeb HAPI', 'IMAP BT', 'nT', COLOR.bt, imapMag.rows, row => toFiniteNumber(row[1])),
    buildHapiChart('historic-imap-bz-gsm', 'cdaweb-ace-wind-imap', 'IMAP', 'NASA CDAWeb HAPI', 'IMAP Bz GSM', 'nT', COLOR.bz, imapMag.rows, row => vectorComponent(row[2], 2)),
    buildHapiChart('historic-imap-speed', 'cdaweb-ace-wind-imap', 'IMAP', 'NASA CDAWeb HAPI', 'IMAP speed', 'km/s', COLOR.speed, imapSwapi.rows, row => toFiniteNumber(row[2])),
    buildHapiChart('historic-imap-density', 'cdaweb-ace-wind-imap', 'IMAP', 'NASA CDAWeb HAPI', 'IMAP density', 'cm^-3', COLOR.density, imapSwapi.rows, row => toFiniteNumber(row[1])),
  ].forEach(chart => {
    if (chart) {
      charts.push(chart);
    }
  });

  return { charts, warnings };
}

async function buildOmniCharts(range: HistoricPlotRange) {
  const result = await fetchHapiSeries('OMNI_HRO_1MIN', [
    'F',
    'BX_GSE',
    'BY_GSM',
    'BZ_GSM',
    'flow_speed',
    'proton_density',
    'T',
  ], range);
  const charts = [
    buildHapiChart('historic-omni-bt', 'omni-hro', 'OMNI HRO', 'NASA SPDF HAPI', 'OMNI |B|', 'nT', COLOR.bt, result.rows, row => toFiniteNumber(row[1])),
    buildHapiChart('historic-omni-bx-gse', 'omni-hro', 'OMNI HRO', 'NASA SPDF HAPI', 'OMNI Bx GSE', 'nT', COLOR.bx, result.rows, row => toFiniteNumber(row[2])),
    buildHapiChart('historic-omni-by-gsm', 'omni-hro', 'OMNI HRO', 'NASA SPDF HAPI', 'OMNI By GSM', 'nT', COLOR.by, result.rows, row => toFiniteNumber(row[3])),
    buildHapiChart('historic-omni-bz-gsm', 'omni-hro', 'OMNI HRO', 'NASA SPDF HAPI', 'OMNI Bz GSM', 'nT', COLOR.bz, result.rows, row => toFiniteNumber(row[4])),
    buildHapiChart('historic-omni-speed', 'omni-hro', 'OMNI HRO', 'NASA SPDF HAPI', 'OMNI speed', 'km/s', COLOR.speed, result.rows, row => toFiniteNumber(row[5])),
    buildHapiChart('historic-omni-density', 'omni-hro', 'OMNI HRO', 'NASA SPDF HAPI', 'OMNI density', 'n/cc', COLOR.density, result.rows, row => toFiniteNumber(row[6])),
    buildHapiChart('historic-omni-temperature', 'omni-hro', 'OMNI HRO', 'NASA SPDF HAPI', 'OMNI temperature', 'K', COLOR.temperature, result.rows, row => toFiniteNumber(row[7])),
  ].filter((chart): chart is HistoricPlotChart => Boolean(chart));

  return {
    charts,
    warnings: result.warnings,
  };
}

function chooseGoesFileSuffix(range: HistoricPlotRange) {
  const startMs = parseTimestampMs(range.startUtc) ?? 0;
  const stopMs = parseTimestampMs(range.stopUtc) ?? startMs;
  const durationMs = stopMs - startMs;

  if (durationMs <= 6 * 60 * 60 * 1000) {
    return '6-hour';
  }

  if (durationMs <= 24 * 60 * 60 * 1000) {
    return '1-day';
  }

  if (durationMs <= 3 * 24 * 60 * 60 * 1000) {
    return '3-day';
  }

  return '7-day';
}

async function fetchGoesDataset<T>(role: GoesRole, fileName: string) {
  try {
    const data = await fetchJsonWithRetry(`${SWPC_GOES_BASE_URL}/${role}/${fileName}`);

    return Array.isArray(data) ? data as T[] : [];
  } catch {
    return [];
  }
}

function getSpacecraftLabel(rows: GoesScalarPoint[], role: GoesRole) {
  const satellite = rows.find(row => row.satellite !== undefined && row.satellite !== null)?.satellite;

  return satellite ? `GOES-${satellite}` : `GOES ${role}`;
}

function filterGoesRows<T extends GoesScalarPoint>(rows: T[], range: HistoricPlotRange) {
  const startMs = parseTimestampMs(range.startUtc) ?? 0;
  const stopMs = parseTimestampMs(range.stopUtc) ?? startMs;

  return rows.filter(row => {
    const timestampMs = parseTimestampMs(row.time_tag);

    return timestampMs !== null && timestampMs >= startMs && timestampMs <= stopMs;
  });
}

function buildGoesChart(
  id: string,
  spacecraftName: string,
  title: string,
  unit: string,
  color: string,
  rows: GoesScalarPoint[],
  getValue: (row: GoesScalarPoint) => number | null,
): HistoricPlotChart | null {
  const data = downsample(rows)
    .map(row => {
      const timestampMs = parseTimestampMs(row.time_tag);

      return {
        time_tag: timestampMs === null ? '' : toIsoUtc(timestampMs),
        value: getValue(row),
      };
    })
    .filter(point => point.time_tag);

  if (data.length === 0) {
    return null;
  }

  return {
    id,
    sourceId: 'swpc-goes-json',
    spacecraftName,
    source: 'NOAA SWPC GOES JSON',
    title,
    unit,
    color,
    lastSampleTime: data[data.length - 1]?.time_tag ?? null,
    data,
  };
}

async function buildGoesCharts(range: HistoricPlotRange) {
  const suffix = chooseGoesFileSuffix(range);
  const roles: GoesRole[] = ['primary', 'secondary'];
  const charts: HistoricPlotChart[] = [];
  const warnings: string[] = [];

  await Promise.all(roles.map(async role => {
    const [magRowsRaw, electronRowsRaw, protonRowsRaw, xrsRowsRaw] = await Promise.all([
      fetchGoesDataset<GoesMagPoint>(role, `magnetometers-${suffix}.json`),
      fetchGoesDataset<GoesScalarPoint>(role, `integral-electrons-${suffix}.json`),
      fetchGoesDataset<GoesScalarPoint>(role, `integral-protons-${suffix}.json`),
      fetchGoesDataset<GoesScalarPoint>(role, `xrays-${suffix}.json`),
    ]);
    const magRows = filterGoesRows(magRowsRaw, range);
    const electronRows = filterGoesRows(electronRowsRaw.filter(row => row.energy === '>=2 MeV'), range);
    const protonRows = filterGoesRows(protonRowsRaw.filter(row => row.energy === '>=10 MeV'), range);
    const xrsRows = filterGoesRows(xrsRowsRaw.filter(row => row.energy === '0.1-0.8nm'), range);
    const roleLabel = role === 'primary' ? 'primary' : 'secondary';

    [
      buildGoesChart(`historic-goes-${role}-mag-hn`, getSpacecraftLabel(magRows, role), `${roleLabel} MAG Hn`, 'nT', COLOR.bz, magRows, row => toFiniteNumber((row as GoesMagPoint).Hn)),
      buildGoesChart(`historic-goes-${role}-mag-hp`, getSpacecraftLabel(magRows, role), `${roleLabel} MAG Hp`, 'nT', COLOR.by, magRows, row => toFiniteNumber((row as GoesMagPoint).Hp)),
      buildGoesChart(`historic-goes-${role}-mag-total`, getSpacecraftLabel(magRows, role), `${roleLabel} MAG |H|`, 'nT', COLOR.bt, magRows, row => toFiniteNumber((row as GoesMagPoint).total)),
      buildGoesChart(`historic-goes-${role}-electrons-2mev`, getSpacecraftLabel(electronRows, role), `${roleLabel} electrons >=2 MeV`, 'pfu', COLOR.electron, electronRows, row => toFiniteNumber(row.flux)),
      buildGoesChart(`historic-goes-${role}-protons-10mev`, getSpacecraftLabel(protonRows, role), `${roleLabel} protons >=10 MeV`, 'pfu', COLOR.proton, protonRows, row => toFiniteNumber(row.flux)),
      buildGoesChart(`historic-goes-${role}-xrs-long`, getSpacecraftLabel(xrsRows, role), `${roleLabel} XRS 0.1-0.8 nm`, 'W/m^2', COLOR.xrs, xrsRows, row => toFiniteNumber(row.flux)),
    ].forEach(chart => {
      if (chart) {
        charts.push(chart);
      }
    });
  }));

  if (charts.length === 0) {
    warnings.push('GOES SWPC preview exposes only the latest 7 days; no rows matched the selected range.');
  }

  return { charts, warnings };
}

export async function buildHistoricPlotsSnapshot(
  inputRange: HistoricPlotRange,
  requestedSourceIds: string[],
): Promise<HistoricPlotsSnapshot> {
  const normalizedRange = normalizeRange(inputRange);
  const sourceIds = Array.from(new Set(requestedSourceIds));

  if (!normalizedRange) {
    return {
      generatedAtUtc: toIsoUtc(Date.now()),
      range: inputRange,
      requestedSourceIds: sourceIds,
      charts: [],
      warnings: ['Invalid historic plot range.'],
      unsupportedSourceIds: sourceIds,
    };
  }

  const charts: HistoricPlotChart[] = [];
  const warnings: string[] = [];
  const unsupportedSourceIds = sourceIds.filter(sourceId => !PLOT_READY_SOURCE_IDS.has(sourceId));
  const hapiRangeResult = clampRangeToMaxDuration(normalizedRange, MAX_HAPI_PREVIEW_RANGE_MS);
  const goesRangeResult = clampRangeToMaxDuration(normalizedRange, MAX_GOES_PREVIEW_RANGE_MS);

  if (hapiRangeResult.clamped && (sourceIds.includes('cdaweb-ace-wind-imap') || sourceIds.includes('omni-hro'))) {
    warnings.push('HAPI preview was limited to the last 31 days of the selected window.');
  }

  if (goesRangeResult.clamped && (sourceIds.includes('swpc-goes-json') || sourceIds.includes('ncei-goes-r-mag-seiss'))) {
    warnings.push('GOES JSON preview was limited to the last 7 days of the selected window.');
  }

  if (sourceIds.includes('cdaweb-ace-wind-imap')) {
    const result = await buildCdawebAceWindImapCharts(hapiRangeResult.range);
    charts.push(...result.charts);
    warnings.push(...result.warnings);
  }

  if (sourceIds.includes('omni-hro')) {
    const result = await buildOmniCharts(hapiRangeResult.range);
    charts.push(...result.charts);
    warnings.push(...result.warnings);
  }

  if (sourceIds.includes('swpc-goes-json')) {
    const result = await buildGoesCharts(goesRangeResult.range);
    charts.push(...result.charts);
    warnings.push(...result.warnings);
  }

  if (unsupportedSourceIds.length > 0) {
    warnings.push(`No plot parser wired yet for: ${unsupportedSourceIds.join(', ')}.`);
  }

  return {
    generatedAtUtc: toIsoUtc(Date.now()),
    range: normalizedRange,
    requestedSourceIds: sourceIds,
    charts,
    warnings: Array.from(new Set(warnings)).slice(0, 12),
    unsupportedSourceIds,
  };
}
