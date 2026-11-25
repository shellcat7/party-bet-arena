import { Fragment } from "react";
import type { CSSProperties, ReactNode } from "react";
import { Meadow } from "./scenes/Meadow";
import type { Biome, Light } from "../lib/pass";
import { accentInk, displayAccent } from "../lib/constants";
import { BrandMark, accentStyle } from "./ui";

/*
 * Tickets, laid out like a boarding pass in Apple Wallet: a header with what the ticket is for,
 * the picks set large, a painted landscape, a row of labelled fields, and a stub below a
 * perforation that carries the ticket's state. The colour comes from the ticket's first pick.
 * The body and the stub are separate pieces with the notches cut out of them, so the shadow
 * follows the cut-outs.
 */

export type PassPick = { lane: number; name: string; icon: string; accent: string; position?: string };

export type PassStatus = "placed" | "closed" | "hit" | "miss" | "void";

export type PassField = { label: string; value: ReactNode; align?: "end" };

export function Pass(props: {
  /** Accent colour the pass is tinted with. */
  accent: string;
  /** What the pass belongs to, next to the app mark (a room name, or the app name). */
  title: string;
  headerFields: PassField[];
  primary: ReactNode;
  art?: { biome: Biome; light?: Light; label: string; seed?: number; animate?: boolean };
  fields: PassField[];
  stub: ReactNode;
  label: string;
  className?: string;
}) {
  const accent = displayAccent(props.accent);
  // Light colours (white, yellow, orange, pink) print as a light pass with dark type, as in Wallet.
  const light = accentInk(accent) !== "#ffffff";
  return (
    <article
      className={["pass", light ? "pass--light" : "", props.className ?? ""].filter(Boolean).join(" ")}
      style={{ "--pass-accent": accent } as CSSProperties}
      aria-label={props.label}
    >
      <div className="pass__body">
        <header className="pass__head">
          <span className="pass__title">
            <BrandMark size={22} />
            <span>{props.title}</span>
          </span>
          {props.headerFields.map((field) => (
            <span key={field.label} className="pass__head-field">
              <small>{field.label}</small>
              <strong>{field.value}</strong>
            </span>
          ))}
        </header>

        <div className="pass__primary">{props.primary}</div>

        {props.art && (
          <div className="pass__art">
            <Meadow
              label={props.art.label}
              biome={props.art.biome}
              light={props.art.light}
              seed={props.art.seed}
              paused={!props.art.animate}
            />
          </div>
        )}

        <dl className="pass__fields" style={{ "--columns": props.fields.length } as CSSProperties}>
          {props.fields.map((field) => (
            <div key={field.label} className={field.align === "end" ? "is-end" : undefined}>
              <dt>{field.label}</dt>
              <dd>{field.value}</dd>
            </div>
          ))}
        </dl>
      </div>
      <footer className="pass__stub">{props.stub}</footer>
    </article>
  );
}

/**
 * The picks, set large. One pick stands alone, like a destination; two or three read as a route,
 * first on the left and last on the right, as the airports on a boarding pass.
 */
export function PassPicks(props: { picks: PassPick[] }) {
  if (props.picks.length === 1) {
    const [pick] = props.picks;
    return (
      <div className="pass-solo">
        <span className="pass-lane" style={accentStyle(pick.accent)}>
          {pick.lane}
        </span>
        <strong>
          <span aria-hidden="true">{pick.icon} </span>
          {pick.name}
        </strong>
      </div>
    );
  }
  return (
    <div className={`pass-route pass-route--${props.picks.length}`}>
      {props.picks.map((pick, index) => (
        <Fragment key={`${pick.lane}-${index}`}>
          {index > 0 && (
            <span className="pass-route__arrow" aria-hidden="true">
              →
            </span>
          )}
          <div className="pass-route__stop">
            {pick.position && <small>{pick.position}</small>}
            <span className="pass-lane" style={accentStyle(pick.accent)}>
              {pick.lane}
            </span>
            <strong>{pick.name}</strong>
          </div>
        </Fragment>
      ))}
    </div>
  );
}

/** The stub states where the ticket stands; it is announced when that changes. */
export function PassStub(props: {
  status: PassStatus;
  title: string;
  detail?: ReactNode;
  value?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className={`pass-stub pass-stub--${props.status}`}>
      <span className="pass-stub__state" role="status">
        <i aria-hidden="true" />
        <span>
          <strong>{props.title}</strong>
          {props.detail && <small>{props.detail}</small>}
        </span>
      </span>
      {props.value && <span className="pass-stub__value">{props.value}</span>}
      {props.action}
    </div>
  );
}
