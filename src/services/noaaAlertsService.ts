export interface NoaaAlert {
  product_id: string | null;
  issue_datetime: string | null;
  message: string | null;
}

export interface NoaaAlertsResponse {
  isConnected: boolean;
  lastUpdated: string | null;
  errorMessage: string | null;
  alerts: NoaaAlert[];
}

const NOAA_ALERTS_ENDPOINT = 'https://services.swpc.noaa.gov/products/alerts.json';

export async function fetchNoaaAlerts(): Promise<NoaaAlertsResponse> {
  try {
    const response = await fetch(NOAA_ALERTS_ENDPOINT, { cache: 'no-store' });

    if (!response.ok) {
      return {
        isConnected: false,
        lastUpdated: null,
        errorMessage: 'NOAA alerts unavailable',
        alerts: []
      };
    }

    const data: any = await response.json();

    if (!Array.isArray(data)) {
      return {
        isConnected: false,
        lastUpdated: null,
        errorMessage: 'Invalid alerts data format',
        alerts: []
      };
    }

    if (data.length === 0) {
      return {
        isConnected: true,
        lastUpdated: new Date().toISOString(),
        errorMessage: 'No current alerts returned by NOAA.',
        alerts: []
      };
    }

    return {
      isConnected: true,
      lastUpdated: new Date().toISOString(),
      errorMessage: null,
      // Preserve only fields that are actually present; expose null for absent fields
      alerts: data.map((alert: any) => ({
        product_id: alert.product_id ?? null,
        issue_datetime: alert.issue_datetime ?? null,
        message: alert.message ?? null,
      }))
    };
  } catch (error) {
    return {
      isConnected: false,
      lastUpdated: null,
      errorMessage: 'NOAA alerts unavailable',
      alerts: []
    };
  }
}
