import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";

/** An action or fact tile under a pass, as in Wallet: a coloured icon, a title and a detail. */
export function Tile(props: {
  icon: ReactNode;
  tone: "green" | "purple" | "blue" | "gray" | "orange";
  title: string;
  detail?: ReactNode;
  onClick?: () => void;
  children?: ReactNode;
}) {
  const body = (
    <>
      <span className={`tile__icon tile__icon--${props.tone}`} aria-hidden="true">
        {props.icon}
      </span>
      <span className="tile__text">
        <strong>{props.title}</strong>
        {props.detail && <small>{props.detail}</small>}
      </span>
      {props.children}
      {props.onClick && <ChevronRight className="tile__chevron" size={16} aria-hidden="true" />}
    </>
  );
  return props.onClick ? (
    <button className="tile" type="button" onClick={props.onClick}>
      {body}
    </button>
  ) : (
    <div className="tile">{body}</div>
  );
}
