import type { HTMLAttributes, ReactNode } from "react";

interface GlassPanelProps extends HTMLAttributes<HTMLDivElement> {
  title?: string;
  subtitle?: string;
  accent?: ReactNode;
  strong?: boolean;
  innerClassName?: string;
  children: ReactNode;
}

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

export function GlassPanel({
  title,
  subtitle,
  accent,
  strong,
  className,
  innerClassName,
  children,
  ...rest
}: GlassPanelProps) {
  return (
    <section
      className={cx("glass-panel", strong && "glass-panel--strong", className)}
      {...rest}
    >
      {(title || subtitle || accent) && (
        <header className="flex items-start justify-between gap-4 px-5 pt-4 pb-3 border-b border-[color:var(--color-glass-edge)]">
          <div className="min-w-0">
            {title && (
              <h3 className="text-[11px] font-semibold tracking-[0.22em] uppercase text-[color:var(--color-ink-dim)]">
                {title}
              </h3>
            )}
            {subtitle && (
              <p className="mt-1 text-sm text-[color:var(--color-ink)] truncate">
                {subtitle}
              </p>
            )}
          </div>
          {accent && <div className="flex-shrink-0">{accent}</div>}
        </header>
      )}
      <div className={cx("relative px-5 py-4", innerClassName)}>{children}</div>
    </section>
  );
}
