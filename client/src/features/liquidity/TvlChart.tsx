import { useEffect, useRef } from "react";
import { createChart, AreaSeries, type IChartApi, type Time } from "lightweight-charts";
import type { PoolChartPoint } from "./types.ts";

interface Props {
  points: PoolChartPoint[];
  metric: "tvl" | "apy";
}

/**
 * Lightweight-charts area series. Tokens come from CSS vars so the chart
 * follows our theme (dark/light) without re-creating the chart.
 */
export function TvlChart({ points, metric }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const styles = getComputedStyle(document.documentElement);
    const text = styles.getPropertyValue("--text-dim").trim() || "#8e8e96";
    const border = styles.getPropertyValue("--border-soft").trim() || "#1a1a20";
    const accent = styles.getPropertyValue("--accent").trim() || "#8b6cf0";

    const chart = createChart(containerRef.current, {
      autoSize: true,
      layout: {
        background: { color: "transparent" },
        textColor: text,
        fontFamily: "Inter, sans-serif",
      },
      grid: { vertLines: { color: border }, horzLines: { color: border } },
      timeScale: { timeVisible: false, borderColor: border },
      rightPriceScale: { borderColor: border },
      handleScroll: false,
      handleScale: false,
    });
    const series = chart.addSeries(AreaSeries, {
      lineColor: accent,
      topColor: `${accent}55`,
      bottomColor: `${accent}00`,
      lineWidth: 2,
      priceFormat:
        metric === "tvl"
          ? { type: "custom", formatter: (v: number) => `$${formatCompact(v)}` }
          : { type: "custom", formatter: (v: number) => `${v.toFixed(2)}%` },
    });
    series.setData(
      points.map((p) => ({
        time: p.time as Time,
        value: metric === "tvl" ? p.tvlUsd : p.apy,
      })),
    );
    chart.timeScale().fitContent();
    chartRef.current = chart;
    return () => {
      chart.remove();
      chartRef.current = null;
    };
  }, [points, metric]);

  return <div ref={containerRef} className="w-full h-64" />;
}

function formatCompact(v: number): string {
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(2)}K`;
  return v.toFixed(2);
}
