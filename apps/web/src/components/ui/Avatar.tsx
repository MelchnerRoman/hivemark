export function Avatar({
  label,
  color,
  size = 28,
}: {
  label: string;
  color: string;
  size?: number;
}) {
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-full font-medium text-white"
      style={{ width: size, height: size, backgroundColor: color, fontSize: size * 0.4 }}
      title={label}
    >
      {label}
    </div>
  );
}
