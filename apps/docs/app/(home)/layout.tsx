import { HomeLayout } from "fumadocs-ui/layouts/home";
import { baseOptions } from "@/lib/layout-options";

export default function HomeGroupLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <HomeLayout {...baseOptions} nav={{ ...baseOptions.nav, transparentMode: "top" }}>
      {children}
    </HomeLayout>
  );
}
