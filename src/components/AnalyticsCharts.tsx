import React, { useState } from 'react';

interface DailyPoint {
  date: string;
  uploaded: number;
  delivered: number;
}

interface CategoryItem {
  category: string;
  count: number;
}

interface ChannelStat {
  channel: string;
  delivered: number;
  failed: number;
  total: number;
}

export const AnalyticsCharts: React.FC<{
  dailyTrend: DailyPoint[];
  categoryBreakdown: CategoryItem[];
  channelStats: ChannelStat[];
}> = ({ dailyTrend, categoryBreakdown, channelStats }) => {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  const maxDaily = Math.max(
    4,
    ...dailyTrend.map((d) => Math.max(d.uploaded, d.delivered))
  );
  const maxCat = Math.max(1, ...categoryBreakdown.map((c) => c.count));

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      {/* 7-Day Report Processing & Delivery Velocity */}
      <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-6">
        <div className="flex items-center justify-between gap-4 mb-6">
          <div>
            <h3 className="text-base font-semibold text-slate-900">
              Report Collection & Delivery Activity
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              7-day clinical uploads vs. physician-verified patient deliveries
            </p>
          </div>
          <div className="flex items-center gap-4 text-xs text-slate-600 shrink-0">
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-sky-600 inline-block" />
              Uploaded
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-teal-600 inline-block" />
              Delivered
            </span>
          </div>
        </div>

        <div className="relative h-52 flex items-end gap-3 pt-6 pb-2 border-b border-slate-100">
          {dailyTrend.map((point, idx) => {
            const upHeight = Math.round((point.uploaded / maxDaily) * 140);
            const delHeight = Math.round((point.delivered / maxDaily) * 140);
            const isHovered = hoveredIdx === idx;

            return (
              <div
                key={point.date}
                onMouseEnter={() => setHoveredIdx(idx)}
                onMouseLeave={() => setHoveredIdx(null)}
                className="flex-1 flex flex-col items-center justify-end gap-2 relative cursor-default"
              >
                {isHovered && (
                  <div className="absolute -top-2 z-10 bg-slate-900 text-white text-[11px] px-2.5 py-1.5 rounded-md whitespace-nowrap shadow-sm tabular-nums">
                    {point.date}: {point.uploaded} uploaded · {point.delivered} delivered
                  </div>
                )}
                <div className="w-full flex items-end justify-center gap-1.5 h-36">
                  <div
                    style={{ height: `${Math.max(4, upHeight)}px` }}
                    className="w-3.5 sm:w-4 bg-sky-600 rounded-t transition-all duration-150"
                  />
                  <div
                    style={{ height: `${Math.max(4, delHeight)}px` }}
                    className="w-3.5 sm:w-4 bg-teal-600 rounded-t transition-all duration-150"
                  />
                </div>
                <span className="text-[11px] font-mono text-slate-500 tabular-nums">
                  {point.date}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Category & Channel Performance */}
      <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-6 flex flex-col justify-between gap-6">
        <div>
          <h3 className="text-base font-semibold text-slate-900">
            Channel Delivery Performance
          </h3>
          <p className="text-xs text-slate-500 mt-0.5 mb-4">
            Automated patient notifications across Email, WhatsApp, and SMS
          </p>
          <div className="space-y-3">
            {channelStats.map((ch) => {
              const rate =
                ch.total > 0 ? Math.round((ch.delivered / ch.total) * 100) : 100;
              return (
                <div key={ch.channel} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-slate-700 capitalize">
                      {ch.channel === 'whatsapp' ? 'WhatsApp Business' : ch.channel.toUpperCase()}
                    </span>
                    <span className="font-mono text-slate-600 tabular-nums">
                      {ch.delivered}/{ch.total} delivered ({rate}%)
                      {ch.failed > 0 ? ` · ${ch.failed} failed` : ''}
                    </span>
                  </div>
                  <div className="h-2 bg-slate-100 rounded-full overflow-hidden flex">
                    <div
                      style={{ width: `${rate}%` }}
                      className="bg-teal-600 h-full transition-all duration-200"
                    />
                    {ch.failed > 0 && (
                      <div
                        style={{ width: `${100 - rate}%` }}
                        className="bg-rose-500 h-full"
                      />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="pt-4 border-t border-slate-100">
          <h4 className="text-xs font-semibold text-slate-700 mb-3">
            Report Volume by Diagnostic Category
          </h4>
          <div className="space-y-2 max-h-36 overflow-y-auto pr-1">
            {categoryBreakdown.slice(0, 6).map((c) => (
              <div key={c.category} className="flex items-center gap-3 text-xs">
                <span className="w-40 truncate text-slate-600">{c.category}</span>
                <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    style={{ width: `${Math.round((c.count / maxCat) * 100)}%` }}
                    className="bg-sky-600 h-full"
                  />
                </div>
                <span className="font-mono text-slate-800 w-6 text-right tabular-nums">
                  {c.count}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
