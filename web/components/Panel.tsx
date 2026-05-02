import type { HTMLAttributes, ReactNode } from "react";

interface PanelProps extends HTMLAttributes<HTMLDivElement> {
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

export function Panel({
  title,
  subtitle,
  accent,
  strong,
  className,
  innerClassName,
  children,
  ...rest
}: PanelProps) {
  return (
    <section
      className={cx("panel", strong && "panel--strong", className)}
      {...rest}
    >
      {(title || subtitle || accent) && (
        <header className="flex items-start justify-between gap-4 px-4 pt-3 pb-2.5 border-b border-[color:var(--color-rule)]">
          <div className="min-w-0">
            {title && (
              <h3 className="text-[10px] font-medium tracking-[0.14em] uppercase text-[color:var(--color-ink-faint)]">
                {title}
              </h3>
            )}
            {subtitle && (
              <p className="mt-1 text-[12px] leading-tight text-[color:var(--color-ink)] truncate">
                {subtitle}
              </p>
            )}
          </div>
          {accent && <div className="flex-shrink-0">{accent}</div>}
        </header>
      )}
      <div className={cx("relative px-4 py-3", innerClassName)}>{children}</div>
    </section>
  );
}
