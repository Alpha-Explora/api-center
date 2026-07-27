"use client";

import { useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ServiceProposedActionsPanel } from "@/components/proposed-actions-panel";
import { TribeDeprovisioningCard } from "@/components/tribe-deprovisioning-card";
import type { ServiceRegistryEntry } from "@/lib/schemas";

export function ServiceActionsPanel({
  service,
  consumers,
  activatePending,
  deprecatePending,
  retirePending,
  deregisterPending,
  onActivate,
  onDeprecate,
  onRetire,
  onDeregister,
  onDeregistered,
}: {
  service: ServiceRegistryEntry;
  consumers: string[];
  activatePending: boolean;
  deprecatePending: boolean;
  retirePending: boolean;
  deregisterPending: boolean;
  onActivate: () => void;
  onDeprecate: () => void;
  onRetire: () => void;
  onDeregister: () => void;
  onDeregistered: () => void;
}) {
  const isTribe = (service.serviceType ?? "tribe") === "tribe";

  return (
    <>
      <ServiceProposedActionsPanel service={service} />
      {isTribe ? (
        <TribeDeprovisioningCard
          serviceId={service.serviceId}
          ownerTribeId={service.ownerTribeId}
          environments={service.environments}
          onDeregistered={onDeregistered}
        />
      ) : null}
      <Card>
        <CardHeader>
          <CardTitle>Registry lifecycle</CardTitle>
          <CardDescription>
            Registry lifecycle actions only update API Center registration state.
            They do not delete Secret Manager secrets, Confluent topics, S3 sink
            configuration, or deployments.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={onActivate}
            disabled={activatePending}
          >
            Activate
          </Button>
          <Button
            variant="outline"
            onClick={onDeprecate}
            disabled={deprecatePending}
          >
            Deprecate
          </Button>
          <ConfirmAction
            serviceId={service.serviceId}
            title="Retire service"
            description="Retired services stay in the registry but are no longer routable."
            actionLabel="Retire"
            consumers={consumers}
            pending={retirePending}
            onConfirm={onRetire}
          />
          <ConfirmAction
            serviceId={service.serviceId}
            title="Deregister service"
            description="Deregistering removes this service from API Center registry storage only. External resources stay in place until you run a deprovision action."
            actionLabel="Deregister registry entry"
            consumers={consumers}
            pending={deregisterPending}
            onConfirm={onDeregister}
            destructive
          />
        </CardContent>
      </Card>
    </>
  );
}

function ConfirmAction({
  serviceId,
  title,
  description,
  actionLabel,
  consumers,
  pending,
  onConfirm,
  destructive = false,
}: {
  serviceId: string;
  title: string;
  description: string;
  actionLabel: string;
  consumers: string[];
  pending: boolean;
  onConfirm: () => void;
  destructive?: boolean;
}) {
  const [typedServiceId, setTypedServiceId] = useState("");
  const canConfirm = typedServiceId === serviceId && !pending;

  return (
    <Dialog>
      <DialogTrigger render={<Button variant={destructive ? "destructive" : "outline"} />}>
        {actionLabel}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3 text-sm">
          {consumers.length ? (
            <Alert>
              <AlertTitle>Consumed by other services</AlertTitle>
              <AlertDescription>{consumers.join(", ")}</AlertDescription>
            </Alert>
          ) : null}
          <div className="flex flex-col gap-2">
            <label htmlFor={`${actionLabel}-confirm`}>
              Type {serviceId} to confirm.
            </label>
            <Input
              id={`${actionLabel}-confirm`}
              value={typedServiceId}
              onChange={(event) => setTypedServiceId(event.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
          <Button
            variant={destructive ? "destructive" : "default"}
            disabled={!canConfirm}
            onClick={onConfirm}
          >
            {actionLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
