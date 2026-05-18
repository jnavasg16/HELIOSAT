import { fetchSpacecraftTelemetry, type SpacecraftTelemetry } from './spacecraftTelemetryService';
import {
  fetchNoaaEphemerisData,
  fetchNoaaMagnetometerData,
  fetchNoaaPlasmaData,
  type NoaaEphemerisData,
  type NoaaMagnetometerData,
  type NoaaPlasmaData,
  type NoaaServiceResponse,
} from './noaaSolarWindService';

export interface PlaygroundTelemetryData {
  noaaMagData: NoaaServiceResponse<NoaaMagnetometerData>;
  noaaPlasmaData: NoaaServiceResponse<NoaaPlasmaData>;
  noaaEphemerisData: NoaaServiceResponse<NoaaEphemerisData>;
  spacecraftTelemetry: SpacecraftTelemetry[];
}

export async function fetchPlaygroundTelemetry(): Promise<PlaygroundTelemetryData> {
  const [noaaMagData, noaaPlasmaData, noaaEphemerisData] =
    await Promise.all([
      fetchNoaaMagnetometerData(),
      fetchNoaaPlasmaData(),
      fetchNoaaEphemerisData(),
    ]);
  const spacecraftTelemetry = await fetchSpacecraftTelemetry({
    magData: noaaMagData,
    plasmaData: noaaPlasmaData,
    ephemerisData: noaaEphemerisData,
  });

  return {
    noaaMagData,
    noaaPlasmaData,
    noaaEphemerisData,
    spacecraftTelemetry,
  };
}
