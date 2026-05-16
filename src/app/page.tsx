import { AppShell } from '@/components/layout/AppShell';
import { TopStatusBar } from '@/components/layout/TopStatusBar';
import { SolarWindPanel } from '@/components/panels/SolarWindPanel';
import { SelectedSatellitePanel } from '@/components/panels/SelectedSatellitePanel';
import { AlertsPanel } from '@/components/panels/AlertsPanel';
import { DataReadinessPanel } from '@/components/panels/DataReadinessPanel';
import { ForecastModulePanel } from '@/components/panels/ForecastModulePanel';
import { VisualizationSwitcher } from '@/components/globe/VisualizationSwitcher';
import { SatelliteSelectionProvider } from '@/contexts/SatelliteSelectionContext';
import { SatelliteConfigProvider } from '@/contexts/SatelliteConfigContext';
import { fetchNoaaEphemerisData, fetchNoaaMagnetometerData, fetchNoaaPlasmaData } from '@/services/noaaSolarWindService';
import { fetchNoaaAlerts } from '@/services/noaaAlertsService';
import { fetchTleGroup } from '@/services/celestrakService';

export default async function Home() {
  const [noaaMagData, noaaPlasmaData, noaaEphemerisData, noaaAlertsData, celestrakData] = await Promise.all([
    fetchNoaaMagnetometerData(),
    fetchNoaaPlasmaData(),
    fetchNoaaEphemerisData(),
    fetchNoaaAlerts(),
    fetchTleGroup('stations'),
  ]);

  const isNoaaConnected = noaaMagData.isConnected || noaaPlasmaData.isConnected;
  const magTime = noaaMagData.lastUpdated ? new Date(noaaMagData.lastUpdated).getTime() : 0;
  const plasmaTime = noaaPlasmaData.lastUpdated ? new Date(noaaPlasmaData.lastUpdated).getTime() : 0;
  const lastUpdated = magTime > plasmaTime ? noaaMagData.lastUpdated : (plasmaTime > 0 ? noaaPlasmaData.lastUpdated : null);
  const partialAvailability = (noaaMagData.isConnected && !noaaPlasmaData.isConnected) || (!noaaMagData.isConnected && noaaPlasmaData.isConnected);

  return (
    <AppShell>
      <TopStatusBar
        noaaMagConnected={isNoaaConnected}
        noaaMagLastUpdated={lastUpdated}
        noaaMagPartial={partialAvailability}
        noaaAlertsConnected={noaaAlertsData.isConnected}
        noaaAlertsLastUpdated={noaaAlertsData.lastUpdated}
        celesTrakConnected={celestrakData.isConnected}
        celesTrakLastUpdated={celestrakData.lastUpdated}
      />

      <SatelliteSelectionProvider>
        <SatelliteConfigProvider initialTleData={celestrakData}>
        <main className="mt-2 grid min-h-0 flex-1 grid-cols-4 grid-rows-4 gap-4 overflow-hidden">

          {/* Left: L1 Solar Wind */}
          <div className="col-span-1 row-span-3">
            <SolarWindPanel
              noaaMagData={noaaMagData}
              noaaPlasmaData={noaaPlasmaData}
              noaaEphemerisData={noaaEphemerisData}
            />
          </div>

          {/* Centre: Earth / Sun-Earth switcher */}
          <div className="col-span-2 row-span-3 min-h-0 min-w-0">
            <VisualizationSwitcher
              noaaMagData={noaaMagData}
              noaaPlasmaData={noaaPlasmaData}
              noaaEphemerisData={noaaEphemerisData}
            />
          </div>

          {/* Right top: Selected Satellite */}
          <div className="col-span-1 row-span-2">
            <SelectedSatellitePanel />
          </div>

          {/* Right bottom: Data Readiness */}
          <div className="col-span-1 row-span-1">
            <DataReadinessPanel
              noaaMagData={noaaMagData}
              noaaPlasmaData={noaaPlasmaData}
              noaaAlertsData={noaaAlertsData}
              celestrakData={celestrakData}
            />
          </div>

          {/* Bottom: Alerts + Forecast */}
          <div className="col-span-3 row-span-1">
            <AlertsPanel noaaAlertsData={noaaAlertsData} />
          </div>
          <div className="col-span-1 row-span-1">
            <ForecastModulePanel />
          </div>

        </main>
        </SatelliteConfigProvider>
      </SatelliteSelectionProvider>
    </AppShell>
  );
}
