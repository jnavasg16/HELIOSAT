import * as satellite from 'satellite.js';
import type { SatelliteTLE } from './celestrakService';

export interface PropagatedSatelliteData {
  satelliteName: string;
  source: string;
  timestamp: string;
  
  positionAvailable: boolean;
  latitude: number | null;
  longitude: number | null;
  
  altitudeAvailable: boolean;
  altitudeKm: number | null;

  velocityAvailable: boolean;
  velocityKmS: number | null;

  inclinationAvailable: boolean;
  inclinationDeg: number | null;
}

export function propagateSatelliteFromTle(tle: SatelliteTLE, date: Date): PropagatedSatelliteData {
  const result: PropagatedSatelliteData = {
    satelliteName: tle.name,
    source: tle.source,
    timestamp: date.toISOString(),
    positionAvailable: false,
    latitude: null,
    longitude: null,
    altitudeAvailable: false,
    altitudeKm: null,
    velocityAvailable: false,
    velocityKmS: null,
    inclinationAvailable: false,
    inclinationDeg: null,
  };

  try {
    const satrec = satellite.twoline2satrec(tle.line1, tle.line2);
    
    // Extract inclination (satrec.inclo is in radians)
    if (satrec && (satrec as any).inclo !== undefined) {
      result.inclinationAvailable = true;
      result.inclinationDeg = satellite.degreesLong((satrec as any).inclo); 
    }

    const positionAndVelocity = satellite.propagate(satrec, date);

    if (positionAndVelocity && positionAndVelocity.position && typeof positionAndVelocity.position !== 'boolean') {
      const positionEci = positionAndVelocity.position as any;
      const gmst = satellite.gstime(date);
      const positionGd = satellite.eciToGeodetic(positionEci, gmst);

      result.positionAvailable = true;
      result.latitude = satellite.degreesLat(positionGd.latitude);
      result.longitude = satellite.degreesLong(positionGd.longitude);
      
      result.altitudeAvailable = true;
      result.altitudeKm = positionGd.height;
    }

    if (positionAndVelocity && positionAndVelocity.velocity && typeof positionAndVelocity.velocity !== 'boolean') {
      const velocityEci = positionAndVelocity.velocity as any;
      const vX = velocityEci.x;
      const vY = velocityEci.y;
      const vZ = velocityEci.z;
      
      if (vX !== undefined && vY !== undefined && vZ !== undefined) {
        const vMag = Math.sqrt(vX*vX + vY*vY + vZ*vZ);
        result.velocityAvailable = true;
        result.velocityKmS = vMag;
      }
    }
  } catch (error) {
    // If propagation fails for a satellite, do not display propagated values for it.
    // It will return false for all availability flags.
  }

  return result;
}
