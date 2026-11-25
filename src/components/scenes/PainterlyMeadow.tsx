// Temporary stand-in; replaced by the painted scene.
export function PainterlyMeadow(props: {
  label: string;
  seed?: number;
  paused?: boolean;
  className?: string;
}) {
  return (
    <div
      className={`scene-stub scene-stub--meadow ${props.className ?? ""}`}
      role="img"
      aria-label={props.label}
    />
  );
}
