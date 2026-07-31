import React from 'react';

export interface ApiReferenceViewProps {
  title?: string;
  description?: string;
}

export function ApiReferenceView({
  title = "APICenter Shared Services API Reference",
  description = "Official public source of truth for platform-owned shared microservices.",
}: ApiReferenceViewProps) {
  return (
    <div className="rounded-xl border border-fd-border bg-fd-card p-6 shadow-sm">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-fd-foreground">{title}</h2>
          <p className="mt-1 text-sm text-fd-muted-foreground">{description}</p>
        </div>
        <span className="inline-flex items-center rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-500 border border-emerald-500/20">
          v1.0 Public API
        </span>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className="rounded-lg border border-fd-border p-4 bg-fd-background/50 hover:bg-fd-accent/50 transition-colors">
          <div className="text-sm font-semibold text-fd-foreground">Messaging & Verification</div>
          <div className="mt-1 text-xs text-fd-muted-foreground">Email, SMS, and OTP Passcode Verification</div>
        </div>
        <div className="rounded-lg border border-fd-border p-4 bg-fd-background/50 hover:bg-fd-accent/50 transition-colors">
          <div className="text-sm font-semibold text-fd-foreground">Identity & OAuth</div>
          <div className="mt-1 text-xs text-fd-muted-foreground">Google OAuth 2.0 & OIDC Token Verification</div>
        </div>
        <div className="rounded-lg border border-fd-border p-4 bg-fd-background/50 hover:bg-fd-accent/50 transition-colors">
          <div className="text-sm font-semibold text-fd-foreground">Platform Utilities</div>
          <div className="mt-1 text-xs text-fd-muted-foreground">Geocoding, Reverse Geocoding & Geofencing</div>
        </div>
      </div>
    </div>
  );
}
