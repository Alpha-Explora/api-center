import type { Metadata } from "next";
import { PublicLandingPage } from "@/components/public-landing-page";

export const metadata: Metadata = {
  title: "APICenter | One gateway for APIs and shared services",
  description:
    "Connect your team's APIs, integrate shared services, and manage service access with APICenter's gateway, registry, and management console.",
};

export default function Home() {
  return <PublicLandingPage />;
}
