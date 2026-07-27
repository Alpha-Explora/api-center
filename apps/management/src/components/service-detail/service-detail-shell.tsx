"use client";

import type { ReactNode } from "react";
import {
  detailSections,
  type DetailSection,
} from "@/components/service-detail/service-detail-navigation";

type ServiceDetailShellProps = {
  activeSection: DetailSection;
  onSelectSection: (section: DetailSection) => void;
  children: ReactNode;
};

export function ServiceDetailShell({
  activeSection,
  onSelectSection,
  children,
}: ServiceDetailShellProps) {
  return (
    <div className="grid min-w-0 gap-6 lg:grid-cols-[18rem_minmax(0,1fr)]">
      <aside className="min-w-0">
        <div className="sticky top-24 flex flex-col gap-2">
          {detailSections.map((item) => (
            <button
              key={item.value}
              type="button"
              data-service-section
              aria-label={`${item.label} ${item.description}`}
              aria-current={activeSection === item.value ? "page" : undefined}
              className={[
                "rounded-lg border p-3 text-left transition-colors",
                activeSection === item.value
                  ? "border-[var(--brand-green)] bg-[var(--brand-green-soft)] text-[var(--brand-green-deep)]"
                  : "bg-card text-muted-foreground hover:bg-accent/60 hover:text-foreground",
              ].join(" ")}
              onClick={() => onSelectSection(item.value)}
            >
              <span className="block text-sm font-medium">{item.label}</span>
              <span className="mt-1 block text-xs">{item.description}</span>
            </button>
          ))}
        </div>
      </aside>

      <main className="min-w-0">{children}</main>
    </div>
  );
}
