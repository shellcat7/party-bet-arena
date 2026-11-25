// Temporary stand-in; replaced by the pixel scene.
export function PixelCarriers(props: { label: string; paused?: boolean; className?: string; seed?: number }) {
  return (
    <div
      className={`scene-stub scene-stub--pixel ${props.className ?? ""}`}
      role="img"
      aria-label={props.label}
    />
  );
}
