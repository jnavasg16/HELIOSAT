"use client";
import React, { useState, useEffect, useMemo } from 'react';
import { Globe2, Orbit, Settings2, Sun } from 'lucide-react';
import { GlobeView } from './GlobeView';
import { SunEarthView } from './SunEarthView';
import { SatelliteConfigModal } from './SatelliteConfigModal';
import { propagateSatelliteFromTle } from '@/services/satellitePropagationService';
import type { NoaaServiceResponse, NoaaEphemerisData, NoaaMagnetometerData, NoaaPlasmaData } from '@/services/noaaSolarWindService';
import { useSatelliteSelection } from '@/contexts/SatelliteSelectionContext';
import { getSatelliteKey, useSatelliteConfig } from '@/contexts/SatelliteConfigContext';

type ViewMode = 'earth' | 'sunearth';

const EARTH_RADIUS_KM = 6371;
const PROPAGATION_INTERVAL_MS = 30_000;
const ORBIT_STEPS = 90;
const ORBIT_STEP_MS = 90_000;

interface Props {
  noaaMagData: NoaaServiceResponse<NoaaMagnetometerData>;
  noaaPlasmaData: NoaaServiceResponse<NoaaPlasmaData>;
  noaaEphemerisData: NoaaServiceResponse<NoaaEphemerisData>;
}

export const VisualizationSwitcher: React.FC<Props> = ({ noaaMagData, noaaPlasmaData, noaaEphemerisData }) => {
  const [viewMode, setViewMode] = useState<ViewMode>('earth');
  const [propagationTime, setPropagationTime] = useState(() => Date.now());

  const { selectedTle } = useSatelliteSelection();
  const {
    trackedTles,
    tleData,
    orbitPropagationEnabled,
    setOrbitPropagationEnabled,
    openModal,
  } = useSatelliteConfig();

  const selectedTrackedTle = selectedTle && trackedTles.some(tle => getSatelliteKey(tle) === getSatelliteKey(selectedTle))
    ? selectedTle
    : null;

  const mapStatus = trackedTles.length === 0
    ? 'No satellites selected on map'
    : `Showing ${trackedTles.length} selected satellite${trackedTles.length === 1 ? '' : 's'} on map${
      orbitPropagationEnabled && selectedTrackedTle ? ' · orbit path propagated' : ''
    }`;

  const catalogStatus = tleData.isConnected
    ? `${tleData.tles.length} catalog objects available`
    : tleData.errorMessage ?? 'CelesTrak unavailable';

  useEffect(() => {
    const id = setInterval(() => setPropagationTime(Date.now()), PROPAGATION_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  const propagated = useMemo(() => {
    const now = new Date(propagationTime);
    return trackedTles.map(tle => propagateSatelliteFromTle(tle, now));
  }, [trackedTles, propagationTime]);

  const orbitPathPoints = useMemo(() => {
    if (!orbitPropagationEnabled || !selectedTrackedTle) return [];
    const pts: [number, number, number][] = [];
    for (let i = 0; i <= ORBIT_STEPS; i++) {
      const d = propagateSatelliteFromTle(selectedTrackedTle, new Date(propagationTime + i * ORBIT_STEP_MS));
      if (d.positionAvailable && d.latitude != null && d.longitude != null && d.altitudeKm != null) {
        pts.push([d.latitude, d.longitude, Math.max(0.02, d.altitudeKm / EARTH_RADIUS_KM)]);
      }
    }
    return pts.length > 1 ? pts : [];
  }, [orbitPropagationEnabled, selectedTrackedTle, propagationTime]);

  return (
    <>
      {/* Modal (renders at fixed overlay level) */}
      <SatelliteConfigModal />

      <div className="flex h-full min-w-0 flex-col gap-2">
        {/* Slim toolbar: view mode + satellite config button */}
        <div className="flex min-w-0 items-center gap-2">

          {/* View mode toggle */}
          <div className="flex bg-slate-800/50 border border-slate-700/50 rounded-md overflow-hidden">
            {(['earth', 'sunearth'] as ViewMode[]).map(mode => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-mono uppercase tracking-widest transition-colors border-r border-slate-700/50 last:border-r-0 ${
                  viewMode === mode
                    ? 'bg-cyan-500/20 text-cyan-300'
                    : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                {mode === 'earth' ? (
                  <>
                    <Globe2 className="w-3 h-3" aria-hidden="true" />
                    Earth Orbit
                  </>
                ) : (
                  <>
                    <Sun className="w-3 h-3" aria-hidden="true" />
                    Sun-Earth
                  </>
                )}
              </button>
            ))}
          </div>

          {/* Satellite config button — only in Earth mode */}
          {viewMode === 'earth' && (
            <button
              onClick={openModal}
              className="flex items-center gap-2 px-3 py-1.5 bg-slate-800/50 border border-slate-700/50 rounded-md text-[10px] font-mono text-slate-400 hover:text-slate-200 hover:border-slate-600/70 transition-colors"
              title={catalogStatus}
            >
              <Settings2 className="w-3 h-3" aria-hidden="true" />
              Configure Satellites
            </button>
          )}

          {viewMode === 'earth' && (
            <button
              onClick={() => setOrbitPropagationEnabled(!orbitPropagationEnabled)}
              disabled={!selectedTrackedTle}
              title={selectedTrackedTle ? 'Toggle propagated orbit path' : 'Select an active tracked satellite to propagate its orbit'}
              className={`flex items-center gap-2 px-3 py-1.5 border rounded-md text-[10px] font-mono transition-colors ${
                orbitPropagationEnabled
                  ? 'bg-cyan-500/10 border-cyan-500/40 text-cyan-300'
                  : 'bg-slate-800/50 border-slate-700/50 text-slate-500 hover:text-slate-300'
              } disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:text-slate-500`}
            >
              <Orbit className="w-3 h-3" aria-hidden="true" />
              Orbit Path
            </button>
          )}

          {/* Satellite count badge */}
          {viewMode === 'earth' && (
            <span className="text-[10px] font-mono text-slate-600 ml-auto">
              {mapStatus}
            </span>
          )}
        </div>

        {/* Main visualization */}
        <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden rounded-lg border border-slate-700/50 bg-[#020617]">
          {viewMode === 'earth' ? (
            <GlobeView
              tles={trackedTles}
              propagatedSatellites={propagated}
              orbitPathPoints={orbitPathPoints}
              showCount={mapStatus}
            />
          ) : (
            <SunEarthView
              noaaMagData={noaaMagData}
              noaaPlasmaData={noaaPlasmaData}
              noaaEphemerisData={noaaEphemerisData}
            />
          )}
        </div>
      </div>
    </>
  );
};
