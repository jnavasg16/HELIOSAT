import React from 'react';
import { GlassCard } from '../ui/GlassCard';

export const ForecastModulePanel: React.FC = () => {
  return (
    <GlassCard title="Forecast Module" className="h-full flex flex-col">
      <div className="flex-1 flex flex-col justify-center items-center text-center p-4">
        <div className="text-amber-500/80 mb-2 font-mono uppercase tracking-widest text-sm">
          Forecast module not connected.
        </div>
        <p className="text-[10px] text-slate-400 font-mono leading-relaxed max-w-[90%]">
          This MVP does not display synthetic forecasts. Connect a real NOAA/NASA forecast endpoint to enable this module.
        </p>
      </div>

      <div className="mt-auto border-t border-slate-800/50 pt-4">
        <h4 className="text-[10px] font-semibold uppercase tracking-widest text-slate-500 mb-3">
          Pending External Sources
        </h4>
        <div className="grid grid-cols-2 gap-2">
          <div className="bg-slate-900/40 border border-slate-800/50 p-2 rounded flex flex-col gap-1">
            <span className="text-[9px] uppercase tracking-wider text-slate-400 truncate" title="NOAA 3-day forecast">NOAA 3-day forecast</span>
            <span className="text-[10px] font-mono text-slate-600">Pending integration</span>
          </div>
          <div className="bg-slate-900/40 border border-slate-800/50 p-2 rounded flex flex-col gap-1">
            <span className="text-[9px] uppercase tracking-wider text-slate-400 truncate" title="NOAA WSA-Enlil">NOAA WSA-Enlil</span>
            <span className="text-[10px] font-mono text-slate-600">Pending integration</span>
          </div>
          <div className="bg-slate-900/40 border border-slate-800/50 p-2 rounded flex flex-col gap-1">
            <span className="text-[9px] uppercase tracking-wider text-slate-400 truncate" title="NASA DONKI events">NASA DONKI events</span>
            <span className="text-[10px] font-mono text-slate-600">Pending integration</span>
          </div>
          <div className="bg-slate-900/40 border border-slate-800/50 p-2 rounded flex flex-col gap-1">
            <span className="text-[9px] uppercase tracking-wider text-slate-400 truncate" title="Kp forecast source">Kp forecast source</span>
            <span className="text-[10px] font-mono text-slate-600">Pending integration</span>
          </div>
        </div>
      </div>
    </GlassCard>
  );
};
