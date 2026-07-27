"use client";

import Link from "next/link";
import { useState } from "react";
import { EyeIcon, ShieldCheckIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";

type ApiProduct = {
  productId: string;
  displayName: string;
  category: string;
  ownerTeam: string;
  serviceTier: string;
  requiredScopes: string[];
  exposes: string[];
  onboardingStatus: string;
};

type MarketplaceAction = {
  id: string;
  product: ApiProduct;
  label: string;
  source: "Availability" | "Access request";
  severity: "critical" | "warning" | "info";
  evidence: string;
  action: {
    label: string;
    href: string;
  };
  priority: number;
};

export function ApiMarketplaceClient({ products }: { products: ApiProduct[] }) {
  const [selectedActionId, setSelectedActionId] = useState<string>();
  const marketplaceActions = buildMarketplaceActions(products);
  const selectedAction =
    marketplaceActions.find((action) => action.id === selectedActionId) ??
    marketplaceActions[0];

  return (
    <div className="flex flex-col gap-5">
      <MarketplaceActionReview
        actions={marketplaceActions}
        selectedAction={selectedAction}
        onSelectAction={setSelectedActionId}
      />
      <div className="grid gap-3 md:grid-cols-2">
        {products.map((product) => (
          <article className="rounded-md border p-4" key={product.productId}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold">
                  {product.displayName}
                </h2>
                <p className="text-sm text-muted-foreground">
                  {product.category}
                </p>
              </div>
              <Badge variant={isDeprecated(product) ? "destructive" : "secondary"}>
                {product.onboardingStatus}
              </Badge>
            </div>
            <dl className="mt-3 grid gap-2 text-sm">
              <div>
                <dt className="text-muted-foreground">Owner</dt>
                <dd>{product.ownerTeam}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Tier</dt>
                <dd>{product.serviceTier}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Scopes</dt>
                <dd>{product.requiredScopes.join(", ") || "None"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Routes</dt>
                <dd>{product.exposes.join(", ") || "None"}</dd>
              </div>
            </dl>
            <Link
              href={productDetailHref(product)}
              className="mt-3 inline-flex h-9 items-center justify-center rounded-md border px-3 text-sm font-medium hover:bg-muted"
            >
              Review product
            </Link>
          </article>
        ))}
      </div>
    </div>
  );
}

function MarketplaceActionReview({
  actions,
  selectedAction,
  onSelectAction,
}: {
  actions: MarketplaceAction[];
  selectedAction?: MarketplaceAction;
  onSelectAction: (actionId: string) => void;
}) {
  if (!actions.length) {
    return (
      <section className="rounded-lg border bg-muted/10 p-4">
        <div className="flex items-center gap-2 text-sm font-medium">
          <ShieldCheckIcon data-icon="inline-start" />
          Marketplace onboarding
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          No marketplace products are available for onboarding.
        </p>
      </section>
    );
  }

  return (
    <section className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(21rem,0.8fr)]">
      <div className="overflow-hidden rounded-lg border">
        <div className="hidden grid-cols-[minmax(11rem,0.8fr)_8rem_minmax(0,1fr)_2.25rem] gap-3 border-b bg-muted/30 px-3 py-2 text-xs font-medium text-muted-foreground md:grid">
          <span>Product</span>
          <span>Severity</span>
          <span>Evidence</span>
          <span className="sr-only">Inspect</span>
        </div>
        <div className="divide-y">
          {actions.map((action) => (
            <MarketplaceActionRow
              key={action.id}
              action={action}
              selected={action.id === selectedAction?.id}
              onSelect={() => onSelectAction(action.id)}
            />
          ))}
        </div>
      </div>
      {selectedAction ? (
        <MarketplaceActionDetail action={selectedAction} />
      ) : null}
    </section>
  );
}

function MarketplaceActionRow({
  action,
  selected,
  onSelect,
}: {
  action: MarketplaceAction;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 px-3 py-3 md:grid-cols-[minmax(11rem,0.8fr)_8rem_minmax(0,1fr)_2.25rem] md:items-start">
      <div className="min-w-0">
        <div className="truncate font-medium">{action.product.displayName}</div>
        <div className="truncate text-xs text-muted-foreground">
          {action.label}
        </div>
      </div>
      <div className="col-start-1 md:col-auto">
        <Badge variant={action.severity === "info" ? "secondary" : "destructive"}>
          {action.severity}
        </Badge>
      </div>
      <div className="col-start-1 min-w-0 break-words text-sm text-muted-foreground md:col-auto">
        {action.evidence}
      </div>
      <button
        type="button"
        aria-pressed={selected}
        aria-label={`Inspect marketplace action ${action.product.displayName}`}
        title={`Inspect marketplace action ${action.product.displayName}`}
        onClick={onSelect}
        className="col-start-2 row-start-1 inline-flex h-7 w-7 items-center justify-center rounded-md border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-pressed:bg-muted aria-pressed:text-foreground md:col-auto md:row-auto"
      >
        <EyeIcon data-icon="inline-end" />
      </button>
    </div>
  );
}

function MarketplaceActionDetail({ action }: { action: MarketplaceAction }) {
  return (
    <aside
      aria-label="Selected marketplace action detail"
      className="order-first rounded-lg border bg-muted/10 p-4 xl:order-none"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium">Selected marketplace action</div>
          <div className="mt-1 truncate text-base font-medium">
            {action.label}
          </div>
          <div className="mt-1 text-sm text-muted-foreground">
            {action.product.displayName} / {action.source}
          </div>
        </div>
        <Badge variant={action.severity === "info" ? "secondary" : "destructive"}>
          {action.severity}
        </Badge>
      </div>

      <div className="mt-4 border-t pt-4">
        <div className="text-xs font-medium text-muted-foreground">Evidence</div>
        <p className="mt-1 break-words text-sm text-muted-foreground">
          {action.evidence}
        </p>
      </div>

      <div className="mt-4 border-t pt-4">
        <div className="text-xs font-medium text-muted-foreground">
          Next action
        </div>
        <Link
          href={action.action.href}
          className="mt-1 inline-flex items-center gap-1 text-sm font-medium underline-offset-4 hover:underline"
        >
          {action.action.label}
          <ShieldCheckIcon data-icon="inline-end" />
        </Link>
      </div>
    </aside>
  );
}

function buildMarketplaceActions(products: ApiProduct[]) {
  return products.map(buildMarketplaceAction).sort(compareMarketplaceActions);
}

function buildMarketplaceAction(product: ApiProduct): MarketplaceAction {
  if (isDeprecated(product)) {
    return {
      id: `deprecated:${product.productId}`,
      product,
      label: "Review replacement path",
      source: "Availability",
      severity: "critical",
      evidence: `${product.displayName} is deprecated before onboarding.`,
      action: {
        label: "Open product detail",
        href: serviceDetailHref(product.productId, "governance"),
      },
      priority: 0,
    };
  }

  return {
    id: `available:${product.productId}`,
    product,
    label: "Start onboarding request",
    source: "Access request",
    severity: "info",
    evidence: `${product.displayName} is available with ${formatCount(product.requiredScopes.length, "required scope")} and ${formatCount(product.exposes.length, "route")}.`,
    action: {
      label: "Open product detail",
      href: serviceDetailHref(product.productId, "summary"),
    },
    priority: 1,
  };
}

function productDetailHref(product: ApiProduct) {
  return serviceDetailHref(
    product.productId,
    isDeprecated(product) ? "governance" : "summary",
  );
}

function serviceDetailHref(serviceId: string, section: string) {
  return `/tribes/${encodeURIComponent(serviceId)}?section=${encodeURIComponent(section)}`;
}

function compareMarketplaceActions(
  left: MarketplaceAction,
  right: MarketplaceAction,
) {
  const severityDelta = severityRank(left) - severityRank(right);
  if (severityDelta !== 0) return severityDelta;
  const priorityDelta = left.priority - right.priority;
  if (priorityDelta !== 0) return priorityDelta;
  return left.product.displayName.localeCompare(right.product.displayName);
}

function severityRank(action: MarketplaceAction) {
  if (action.severity === "critical") return 0;
  if (action.severity === "warning") return 1;
  return 2;
}

function isDeprecated(product: ApiProduct) {
  return /deprecated|retired|sunset/i.test(product.onboardingStatus);
}

function formatCount(count: number, singular: string) {
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
}
