import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export function DeveloperPortalRequestPanel({
  disabled,
  onSubmit,
  ownerTribeId,
  pending,
}: {
  disabled: boolean;
  onSubmit: (input: {
    ownerTribeId: string;
    requestedMaxRequests: number;
    reason: string;
  }) => void;
  ownerTribeId: string;
  pending: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Request quota increase</CardTitle>
        <CardDescription>
          Create an approval request for this tribe without changing quota policy
          directly.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            onSubmit({
              ownerTribeId,
              requestedMaxRequests: Number(form.get("requestedMaxRequests")),
              reason: String(form.get("reason")),
            });
          }}
        >
          <Field>
            <FieldLabel htmlFor="developer-portal-requested-max">
              Requested max requests
            </FieldLabel>
            <Input
              id="developer-portal-requested-max"
              name="requestedMaxRequests"
              type="number"
              min={1}
              required
              disabled={disabled || pending}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="developer-portal-request-reason">
              Request reason
            </FieldLabel>
            <Textarea
              id="developer-portal-request-reason"
              name="reason"
              className="min-h-24"
              required
              disabled={disabled || pending}
            />
          </Field>
          <Button type="submit" disabled={disabled || pending}>
            {pending ? "Submitting" : "Submit request"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
