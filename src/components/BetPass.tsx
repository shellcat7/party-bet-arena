import type { CSSProperties, ReactNode } from "react";
import { Meadow } from "./scenes/Meadow";
import type { Biome } from "../lib/pass";
import { BrandMark } from "./ui";

/*
 * Tickets, laid out like a boarding pass in Apple Wallet: a header with the brand and the key
 * facts, the picks set large, a painted landscape, a row of labelled fields, and a stub below a
 * perforation that carries the ticket's state. The colour comes from the ticket's first pick.
 */

export type PassPick = { lane: number; name: string; icon: string; accent: string; position?: string };

export type PassStatus = "placed" | "closed" | "hit" | "miss" | "void";

export type PassField = { label: string; value: ReactNode; align?: "end" };

export function Pass(props: {
  /** Accent colour the pass is tinted with. */
  accent: string;
  brand: string;
  headerFields: PassField[];
  primary: ReactNode;
  art?: { biome: Biome; label: string; animate?: boolean };
  fields: PassField[];
  auxFields?: PassField[];
  stub: ReactNode;
  label: string;
  className?: string;
}) {
  return (
    <article
      className={props.className ? `pass ${props.className}` : "pass"}
      style={{ "--pass-accent": props.accent } as CSSProperties}
      aria-label={props.label}
    >
      <header className="pass__head">
        <span className="pass__brand">
          <BrandMark size={22} />
          {props.brand}
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
          <Meadow label={props.art.label} biome={props.art.biome} paused={!props.art.animate} />
        </div>
      )}

      <PassFields fields={props.fields} />
      {props.auxFields && <PassFields fields={props.auxFields} />}

      <div className="pass__perforation" aria-hidden="true" />
      <footer className="pass__stub">{props.stub}</footer>
    </article>
  );
}

function PassFields(props: { fields: PassField[] }) {
  return (
    <dl className="pass__fields" style={{ "--columns": props.fields.length } as CSSProperties}>
      {props.fields.map((field) => (
        <div key={field.label} className={field.align === "end" ? "is-end" : undefined}>
          <dt>{field.label}</dt>
          <dd>{field.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** The picks, set large like the airports on a boarding pass. */
export function PassPicks(props: { picks: PassPick[] }) {
  return (
    <ol className={props.picks.length > 1 ? "pass-picks pass-picks--ordered" : "pass-picks"}>
      {props.picks.map((pick, index) => (
        <li key={`${pick.lane}-${index}`}>
          {pick.position && <small>{pick.position}</small>}
          <span className="pass-picks__lane" style={{ "--lane": pick.accent } as CSSProperties}>
            {pick.lane}
          </span>
          <strong>
            <span aria-hidden="true">{pick.icon} </span>
            {pick.name}
          </strong>
        </li>
      ))}
    </ol>
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
