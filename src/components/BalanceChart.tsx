import { useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { useI18n } from "../i18n/i18n";
import { PLAYER_COLORS } from "../lib/constants";
import { balanceSeries } from "../lib/settlement";
import type { Room } from "../lib/types";

const HEIGHT = 220;
const MARGIN = { top: 12, right: 12, bottom: 26, left: 44 };
const LABEL_GUTTER = 64;

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(320);
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) =>
      setWidth(Math.max(240, Math.floor(entry.contentRect.width))),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

function niceTicks(min: number, max: number, count = 4) {
  if (min === max) return [min];
  const raw = (max - min) / count;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((factor) => factor * magnitude).find((value) => value >= raw) ?? raw;
  const ticks = [];
  const end = Math.ceil(max / step) * step;
  for (let value = Math.floor(min / step) * step; value <= end + step / 1000; value += step)
    ticks.push(Math.round(value));
  return ticks;
}

/**
 * Balance over time, one line per bettor. Colour follows the bettor (their avatar colour), a legend
 * is always shown, lines are direct-labelled when there are four or fewer, and a table view gives
 * the exact numbers without relying on colour.
 */
export function BalanceChart(props: { room: Room; highlightId?: string }) {
  const { t, formatNumber } = useI18n();
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const { room } = props;

  const series = useMemo(
    () =>
      room.players.map((player, index) => {
        const slot = PLAYER_COLORS.indexOf(player.accent);
        return {
          player,
          values: balanceSeries(room, player.id),
          color: `var(--series-${(slot >= 0 ? slot : index % PLAYER_COLORS.length) + 1})`,
        };
      }),
    [room],
  );

  const points = (series[0]?.values.length ?? 1) - 1;
  const directLabels = series.length <= 4;
  const plotRight = width - MARGIN.right - (directLabels ? LABEL_GUTTER : 0);
  const plotWidth = Math.max(10, plotRight - MARGIN.left);
  const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
  const all = series.flatMap((item) => item.values);
  // Lines show change, so the axis hugs the data instead of starting at zero.
  const low = Math.min(...all);
  const high = Math.max(...all);
  const padding = Math.max((high - low) * 0.12, Math.abs(high) * 0.05, 10);
  const ticks = niceTicks(low - padding, high + padding);
  const yMin = ticks[0];
  const yMax = ticks[ticks.length - 1] === yMin ? yMin + 1 : ticks[ticks.length - 1];
  const x = (index: number) => MARGIN.left + (points === 0 ? plotWidth / 2 : (index / points) * plotWidth);
  const y = (value: number) => MARGIN.top + plotHeight - ((value - yMin) / (yMax - yMin)) * plotHeight;
  const xLabel = (index: number) => (index === 0 ? t("開始", "Start") : t("{n}R", "R{n}", { n: index }));

  // Direct labels: sort by final value and push apart so names never overlap.
  const labels = directLabels
    ? series
        .map((item) => ({ item, y: y(item.values[points]) }))
        .sort((a, b) => a.y - b.y)
        .reduce<Array<{ item: (typeof series)[number]; y: number }>>((placed, label) => {
          const previous = placed[placed.length - 1];
          placed.push({ ...label, y: previous ? Math.max(label.y, previous.y + 14) : label.y });
          return placed;
        }, [])
    : [];

  const onPointer = (event: ReactPointerEvent<SVGRectElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientX - box.left) / Math.max(1, box.width);
    setHover(Math.max(0, Math.min(points, Math.round(ratio * points))));
  };

  const hovered =
    hover === null
      ? []
      : [...series]
          .sort((a, b) => b.values[hover] - a.values[hover])
          .map((item) => ({ ...item, value: item.values[hover] }));
  const tooltipLeft =
    hover === null ? 0 : Math.min(width - 168, Math.max(0, x(hover) + 12 - (x(hover) > width / 2 ? 184 : 0)));

  if (!series.length || points < 1) return null;

  return (
    <figure className="chart" aria-labelledby="chart-title">
      <figcaption id="chart-title" className="chart__title">
        {t("残高の推移", "Balance over time")}
      </figcaption>
      <ul className="chart__legend" aria-hidden="true">
        {series.map((item) => (
          <li key={item.player.id} className={item.player.id === props.highlightId ? "is-me" : undefined}>
            <i style={{ background: item.color }} />
            {item.player.name}
          </li>
        ))}
      </ul>
      <div className="chart__plot" ref={ref}>
        <svg
          width={width}
          height={HEIGHT}
          role="img"
          aria-label={t(
            "参加者ごとの残高の推移を示す折れ線グラフ。詳細は下の表を参照。",
            "Line chart of each bettor's balance by race. See the table below for exact values.",
          )}
        >
          {ticks.map((tick) => (
            <g key={tick}>
              <line className="chart__grid" x1={MARGIN.left} x2={plotRight} y1={y(tick)} y2={y(tick)} />
              <text className="chart__axis" x={MARGIN.left - 8} y={y(tick)} dy="0.32em" textAnchor="end">
                {formatNumber(tick)}
              </text>
            </g>
          ))}
          {Array.from({ length: points + 1 }, (_, index) => (
            <text key={index} className="chart__axis" x={x(index)} y={HEIGHT - 8} textAnchor="middle">
              {xLabel(index)}
            </text>
          ))}
          {hover !== null && (
            <line
              className="chart__crosshair"
              x1={x(hover)}
              x2={x(hover)}
              y1={MARGIN.top}
              y2={MARGIN.top + plotHeight}
            />
          )}
          {series.map((item) => (
            <g
              key={item.player.id}
              className={
                props.highlightId && item.player.id !== props.highlightId
                  ? "chart__series is-dimmed"
                  : "chart__series"
              }
            >
              <polyline
                fill="none"
                stroke={item.color}
                strokeWidth={item.player.id === props.highlightId ? 3 : 2}
                strokeLinejoin="round"
                strokeLinecap="round"
                points={item.values.map((value, index) => `${x(index)},${y(value)}`).join(" ")}
              />
              <circle
                className="chart__dot"
                cx={x(hover ?? points)}
                cy={y(item.values[hover ?? points])}
                r={4}
                fill={item.color}
              />
            </g>
          ))}
          {labels.map(({ item, y: labelY }) => (
            <text key={item.player.id} className="chart__label" x={plotRight + 8} y={labelY} dy="0.32em">
              {item.player.name.length > 6 ? `${item.player.name.slice(0, 6)}…` : item.player.name}
            </text>
          ))}
          <rect
            className="chart__hit"
            x={MARGIN.left - 10}
            y={0}
            width={plotWidth + 20}
            height={HEIGHT}
            onPointerMove={onPointer}
            onPointerDown={onPointer}
            onPointerLeave={() => setHover(null)}
          />
        </svg>
        {hover !== null && (
          <div className="chart__tooltip" style={{ left: tooltipLeft }} role="presentation">
            <strong>
              {hover === 0 ? t("開始時", "Start") : t("第{n}レース後", "After race {n}", { n: hover })}
            </strong>
            <ul>
              {hovered.map((item) => (
                <li key={item.player.id}>
                  <i style={{ background: item.color }} />
                  <span>{item.player.name}</span>
                  <b>{formatNumber(item.value)}</b>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      <details className="chart__table">
        <summary>{t("表で見る", "Show as table")}</summary>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">{t("参加者", "Bettor")}</th>
                {Array.from({ length: points + 1 }, (_, index) => (
                  <th scope="col" key={index}>
                    {xLabel(index)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {series.map((item) => (
                <tr key={item.player.id}>
                  <th scope="row">{item.player.name}</th>
                  {item.values.map((value, index) => (
                    <td key={index}>{formatNumber(value)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
