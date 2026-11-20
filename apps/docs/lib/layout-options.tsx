import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";
import { BrandTitle } from "@/components/brand-mark";

export const CONSOLE_URL = "https://apicenter.itsandbox.site";

/** The navbar shared by the landing page and the docs. */
export const baseOptions: BaseLayoutProps = {
  nav: { title: <BrandTitle />, url: "/" },
  themeSwitch: { enabled: true, mode: "light-dark-system" },
  links: [
    { text: "Guides", url: "/guides/getting-started", active: "nested-url" },
    { text: "API reference", url: "/reference/api", active: "nested-url" },
    { text: "Events", url: "/reference/events", active: "url" },
    { text: "Console", url: CONSOLE_URL, external: true },
  ],
};
