import React from 'react';
import { GlassCard } from '../ui/GlassCard';
import type { NoaaAlertsResponse } from '@/services/noaaAlertsService';

interface AlertsPanelProps {
  noaaAlertsData: NoaaAlertsResponse;
}

export const AlertsPanel: React.FC<AlertsPanelProps> = ({ noaaAlertsData }) => {
  const { alerts, errorMessage } = noaaAlertsData;
  return (
    <GlassCard title="NOAA Alerts" className="h-full col-span-3">
      <div className="h-full overflow-y-auto pr-2 space-y-4">
        {errorMessage && (
          <div className="text-sm font-mono text-red-400 mb-4 bg-red-900/20 px-3 py-2 rounded border border-red-900/50">
            {errorMessage}
          </div>
        )}

        {alerts && alerts.length > 0 ? (
          alerts.map((alert, index) => (
            <div key={index} className="bg-slate-800/30 border border-slate-700/50 p-3 rounded flex flex-col gap-2">
              <div className="flex justify-between items-center border-b border-slate-700/50 pb-2">
                <span className="text-xs font-mono font-bold text-slate-300">
                  Product ID: {alert.product_id ?? <span className="text-slate-600">Not available</span>}
                </span>
                <span className="text-xs font-mono text-slate-500">
                  {alert.issue_datetime ?? 'Not available'}
                </span>
              </div>
              <pre className="text-xs text-slate-400 whitespace-pre-wrap font-sans leading-relaxed">
                {alert.message ?? <span className="text-slate-600 italic">No message content available</span>}
              </pre>
            </div>
          ))
        ) : (
          !errorMessage && (
            <div className="flex items-center justify-center h-full text-slate-500 font-mono text-sm uppercase tracking-wider">
              No alerts returned by NOAA
            </div>
          )
        )}
      </div>
    </GlassCard>
  );
};
