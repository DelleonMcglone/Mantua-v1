import { useEffect, useRef } from "react";
import { createChart, AreaSeries, type IChartApi, type Time } from "lightweight-charts";
import type { PairRatePoint } from "./use-pair-price-chart.ts";

interface Props {
  points: PairRatePoint[];
  /** Tailwind height class for the chart container. Defaults to h-64. */
  height?: string;
}

/**
 * Pair exchange-rate area chart (quote priced in base) for the pool detail
 * view. Same lightweight-charts setup + CSS-var theming as {@link TvlChart};
 * the price formatter adapts its precision to the rate magnitude so both
 * near-1 stable/stable rates and large cbBTC rates read cleanly.
 */
export function PairRateChart({ points, height = "h-64" }: Props) {
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
      priceFormat: { type: "custom", formatter: formatRate },
    });
    series.setData(points.map((p) => ({ time: p.time as Time, value: p.value })));
    chart.timeScale().fitContent();
    chartRef.current = chart;
    return () => {
      chart.remove();
      chartRef.current = null;
    };
  }, [points]);

  return <div ref={containerRef} className={`w-full ${height}`} />;
}

/** Adaptive precision: more decimals for near-1 rates, fewer for large ones. */
function formatRate(v: number): string {
  if (v >= 1000) return v.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (v >= 1) return v.toFixed(4);
  return v.toFixed(6);
}
