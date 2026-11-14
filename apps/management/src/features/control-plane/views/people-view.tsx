"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeading } from "@/components/page-heading";
import { controlPlane } from "../data/control-plane-repository";
import { useOrganization } from "../view-models/use-organization";
import { OrganizationPicker } from "./organization-picker";
import { toSlug } from "./projects-view";

const ROLES = ["owner", "admin", "developer", "viewer"] as const;

export function PeopleView() {
  const { organizationId, setOrganizationId, organizations } = useOrganization();
  const client = useQueryClient();
  const members = useQuery({ queryKey: ["cp-members", organizationId], queryFn: () => controlPlane.members(organizationId as string), enabled: Boolean(organizationId), retry: false });
  const teams = useQuery({ queryKey: ["cp-teams", organizationId], queryFn: () => controlPlane.teams(organizationId as string), enabled: Boolean(organizationId), retry: false });
  const refresh = () => {
    void client.invalidateQueries({ queryKey: ["cp-members", organizationId] });
    void client.invalidateQueries({ queryKey: ["cp-teams", organizationId] });
  };
  const onError = (error: Error) => toast.error(error.message);
  const setMember = useMutation({ mutationFn: (input: { email: string; role: string }) => controlPlane.setMember(organizationId as string, input.email, input.role), onSuccess: refresh, onError });
  const removeMember = useMutation({ mutationFn: (email: string) => controlPlane.removeMember(organizationId as string, email), onSuccess: refresh, onError });
  const createTeam = useMutation({ mutationFn: (name: string) => controlPlane.createTeam(organizationId as string, { name, slug: toSlug(name) }), onSuccess: refresh, onError });
  const addToTeam = useMutation({ mutationFn: (input: { teamId: string; email: string }) => controlPlane.addTeamMember(organizationId as string, input.teamId, input.email), onSuccess: refresh, onError });
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<string>("developer");
  const [teamName, setTeamName] = useState("");

  return (
    <div className="flex flex-col gap-6">
      <PageHeading
        title="People"
        description="Organization roles: owners and admins manage everything; developers create projects and work in the projects they are assigned; viewers read. Teams are optional groups that receive project roles."
        actions={<OrganizationPicker organizationId={organizationId} organizations={organizations} onChange={setOrganizationId} />}
      />
      <Card>
        <CardHeader>
          <CardTitle>Members</CardTitle>
          <CardDescription>A member&apos;s Google identity is linked on first sign-in; a different identity for the same email is refused.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <form
            className="flex flex-col gap-2 sm:flex-row"
            onSubmit={(event) => {
              event.preventDefault();
              setMember.mutate({ email: email.trim().toLowerCase(), role });
              setEmail("");
            }}
          >
            <Input aria-label="Member email" placeholder="name@company.com" type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
            <select aria-label="Role" className="h-9 rounded-md border bg-background px-2 text-sm" value={role} onChange={(event) => setRole(event.target.value)}>
              {ROLES.map((entry) => (
                <option key={entry}>{entry}</option>
              ))}
            </select>
            <Button disabled={!email.includes("@") || setMember.isPending} type="submit">
              Add or update
            </Button>
          </form>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Identity</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {(members.data ?? []).map((member) => (
                <TableRow key={member.email}>
                  <TableCell>{member.email}</TableCell>
                  <TableCell>
                    <select
                      aria-label={`Role of ${member.email}`}
                      className="h-8 rounded-md border bg-background px-2 text-sm"
                      value={member.role}
                      onChange={(event) => setMember.mutate({ email: member.email, role: event.target.value })}
                    >
                      {ROLES.map((entry) => (
                        <option key={entry}>{entry}</option>
                      ))}
                    </select>
                  </TableCell>
                  <TableCell>{member.identityLinked ? <Badge variant="secondary">linked</Badge> : <Badge variant="outline">pending sign-in</Badge>}</TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="ghost" onClick={() => removeMember.mutate(member.email)}>
                      Remove
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Teams</CardTitle>
          <CardDescription>Assign a team a role on a project from the project&apos;s settings; a team never contains projects.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              createTeam.mutate(teamName.trim());
              setTeamName("");
            }}
          >
            <Input aria-label="Team name" placeholder="Team name" value={teamName} onChange={(event) => setTeamName(event.target.value)} />
            <Button disabled={!teamName.trim()} type="submit">
              Create team
            </Button>
          </form>
          {(teams.data ?? []).map((team) => (
            <TeamRow key={team.id} name={team.name} members={team.members} onAdd={(memberEmail) => addToTeam.mutate({ teamId: team.id, email: memberEmail })} />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function TeamRow({ name, members, onAdd }: { name: string; members: string[]; onAdd: (email: string) => void }) {
  const [email, setEmail] = useState("");
  return (
    <div className="rounded-lg border p-3">
      <p className="font-medium">{name}</p>
      <p className="text-sm text-muted-foreground">{members.length ? members.join(", ") : "No members"}</p>
      <form
        className="mt-2 flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          onAdd(email.trim().toLowerCase());
          setEmail("");
        }}
      >
        <Input aria-label={`Add member to ${name}`} placeholder="member email" value={email} onChange={(event) => setEmail(event.target.value)} />
        <Button size="sm" variant="outline" disabled={!email.includes("@")} type="submit">
          Add
        </Button>
      </form>
    </div>
  );
}
