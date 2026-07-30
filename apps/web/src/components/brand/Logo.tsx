export function LogoMark({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="32" height="32" rx="9" fill="var(--brand)" />
      <circle cx="11" cy="12" r="3" fill="var(--brand-foreground)" />
      <circle cx="21" cy="12" r="3" fill="var(--brand-foreground)" />
      <circle cx="16" cy="21" r="3" fill="var(--brand-foreground)" />
      <path
        d="M13.2 13.2L18.8 13.2M12.4 14.6L15.2 19M19.6 14.6L16.8 19"
        stroke="var(--brand-foreground)"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function Logo({ size = 24 }: { size?: number }) {
  return (
    <div className="flex items-center gap-2">
      <LogoMark size={size} />
      <span className="font-display text-lg font-semibold tracking-tight">Hivemark</span>
    </div>
  );
}
