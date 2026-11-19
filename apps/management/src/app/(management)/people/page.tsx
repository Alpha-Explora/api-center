import type { Metadata } from "next";
import { PeoplePage } from "@/features/control-plane/views/people/people-page";

export const metadata: Metadata = { title: "People" };

export default function Page() {
  return <PeoplePage />;
}
