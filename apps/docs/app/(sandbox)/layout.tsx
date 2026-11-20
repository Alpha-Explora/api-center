import { HomeLayout } from "fumadocs-ui/layouts/home";
import { baseOptions } from "@/lib/layout-options";

/** The API client is a full-page tool with its own sidebar, so it gets the top bar only. */
export default function SandboxGroupLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <HomeLayout {...baseOptions}>
      {children}
    </HomeLayout>
  );
}
