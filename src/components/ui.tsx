import { useId } from "react";
import type { CSSProperties, ReactNode } from "react";
import { ChevronLeft, Minus, Plus } from "lucide-react";
import { useI18n } from "../i18n/i18n";
import { EMOJI_CHOICES } from "../lib/constants";

export const accentStyle = (accent: string) => ({ "--accent": accent }) as CSSProperties;

export function Avatar(props: {
  emoji: string;
  accent: string;
  size?: "sm" | "md" | "lg" | "xl";
  label?: string;
}) {
  return (
    <span
      className={`avatar avatar--${props.size ?? "md"}`}
      style={accentStyle(props.accent)}
      role={props.label ? "img" : undefined}
      aria-label={props.label}
      aria-hidden={props.label ? undefined : true}
    >
      {props.emoji}
    </span>
  );
}

/** Coloured gate number used for racers, like a horse-racing post position. */
export function Lane(props: { number: number; accent: string; small?: boolean }) {
  return (
    <span
      className={props.small ? "lane lane--sm" : "lane"}
      style={accentStyle(props.accent)}
      aria-hidden="true"
    >
      {props.number}
    </span>
  );
}

export function RankBadge(props: { rank: number }) {
  return <span className={`rank-badge rank-badge--${Math.min(props.rank, 4)}`}>{props.rank}</span>;
}

export function PageHeader(props: {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  actions?: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <header className="page-header">
      {props.onBack && (
        <button
          className="icon-button icon-button--quiet page-header__back"
          type="button"
          onClick={props.onBack}
          aria-label={t("戻る", "Back")}
        >
          <ChevronLeft size={24} />
        </button>
      )}
      <div className="page-header__title">
        <h1>{props.title}</h1>
        {props.subtitle && <p>{props.subtitle}</p>}
      </div>
      {props.actions && <div className="page-header__actions">{props.actions}</div>}
    </header>
  );
}

export function Toggle(props: {
  checked: boolean;
  label: string;
  description?: string;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  hideLabel?: boolean;
}) {
  return (
    <label className={props.hideLabel ? "toggle toggle--compact" : "toggle"}>
      <span className={props.hideLabel ? "sr-only" : "toggle__text"}>
        <strong>{props.label}</strong>
        {props.description && <small>{props.description}</small>}
      </span>
      <input
        type="checkbox"
        role="switch"
        checked={props.checked}
        disabled={props.disabled}
        onChange={(event) => props.onChange(event.target.checked)}
      />
      <span className="toggle__track" aria-hidden="true" />
    </label>
  );
}

export function Stepper(props: {
  value: number;
  min: number;
  max: number;
  step?: number;
  label: string;
  onChange: (value: number) => void;
  format?: (value: number) => string;
}) {
  const { t } = useI18n();
  const step = props.step ?? 1;
  const set = (value: number) => props.onChange(Math.max(props.min, Math.min(props.max, value)));
  return (
    <div className="stepper" role="group" aria-label={props.label}>
      <button
        type="button"
        onClick={() => set(props.value - step)}
        disabled={props.value <= props.min}
        aria-label={t("{label}を減らす", "Decrease {label}", { label: props.label })}
      >
        <Minus size={18} />
      </button>
      <output aria-live="polite">{props.format ? props.format(props.value) : props.value}</output>
      <button
        type="button"
        onClick={() => set(props.value + step)}
        disabled={props.value >= props.max}
        aria-label={t("{label}を増やす", "Increase {label}", { label: props.label })}
      >
        <Plus size={18} />
      </button>
    </div>
  );
}

export function SegmentedControl<T extends string>(props: {
  value: T;
  options: Array<{ value: T; label: string; disabled?: boolean }>;
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={props.label}>
      {props.options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={props.value === option.value}
          className={props.value === option.value ? "is-active" : undefined}
          disabled={option.disabled}
          onClick={() => props.onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function EmojiPicker(props: {
  value: string;
  label: string;
  onChange: (emoji: string) => void;
  accent?: string;
}) {
  const choices = EMOJI_CHOICES.includes(props.value) ? EMOJI_CHOICES : [props.value, ...EMOJI_CHOICES];
  return (
    <label className="emoji-picker" style={props.accent ? accentStyle(props.accent) : undefined}>
      <span className="sr-only">{props.label}</span>
      <select value={props.value} onChange={(event) => props.onChange(event.target.value)}>
        {choices.map((emoji) => (
          <option value={emoji} key={emoji}>
            {emoji}
          </option>
        ))}
      </select>
      <span aria-hidden="true">{props.value}</span>
    </label>
  );
}

export function Field(props: { label: string; hint?: string; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{props.label}</label>
      {props.children(id)}
      {props.hint && <small className="field__hint">{props.hint}</small>}
    </div>
  );
}

export function EmptyState(props: {
  icon: ReactNode;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="empty-state">
      <span className="empty-state__icon" aria-hidden="true">
        {props.icon}
      </span>
      <strong>{props.title}</strong>
      {props.children && <p>{props.children}</p>}
      {props.action}
    </section>
  );
}

export function Points(props: { value: number; signed?: boolean; unit?: boolean }) {
  const { formatNumber, formatSigned } = useI18n();
  const tone = props.signed
    ? props.value > 0
      ? "positive"
      : props.value < 0
        ? "negative"
        : "neutral"
    : undefined;
  return (
    <span className={tone ? `points points--${tone}` : "points"}>
      {props.signed ? formatSigned(props.value) : formatNumber(props.value)}
      {props.unit !== false && <small>pt</small>}
    </span>
  );
}

/** The product icon (same artwork as the home-screen icon). */
export function BrandMark(props: { size?: number }) {
  const size = props.size ?? 40;
  return (
    <img
      className="brand-mark"
      src={`${import.meta.env.BASE_URL}favicon.svg`}
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
    />
  );
}

/** open = betting, live = race running, result = settled. One colour per phase across the app. */
export type PhaseTone = "open" | "live" | "result";

export function PhaseTag(props: { tone: PhaseTone; children: ReactNode }) {
  return (
    <span className={`phase-tag phase-tag--${props.tone}`}>
      <i aria-hidden="true" />
      {props.children}
    </span>
  );
}
