export function Badge({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "brand" | "accent" | "warning" | "danger";
}) {
  const toneClasses: Record<string, string> = {
    neutral: "bg-surface-raised text-foreground-muted border border-border",
    brand: "bg-brand-soft text-brand",
    accent: "bg-accent-soft text-accent",
    warning: "bg-warning/15 text-warning",
    danger: "bg-danger-soft text-danger",
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${toneClasses[tone]}`}>
      {children}
    </span>
  );
}
