import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PublicLandingPage } from "@/components/public-landing-page";

describe("PublicLandingPage", () => {
  afterEach(() => {
    cleanup();
  });

  it("explains APICenter and routes visitors to the console and onboarding guide", () => {
    render(<PublicLandingPage />);

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "One gateway for your APIs and shared services",
      }),
    ).toBeTruthy();
    for (const link of screen.getAllByRole("link", {
      name: "Open the console",
    })) {
      expect(link.getAttribute("href")).toBe("/dashboard");
    }
    for (const link of screen.getAllByRole("link", { name: "Read the docs" })) {
      expect(link.getAttribute("href")).toBe(
        "https://docs.apicenter.itsandbox.site/guides/getting-started",
      );
    }
    expect(
      screen.getByRole("img", {
        name: /illustrative apicenter console preview/i,
      }),
    ).toBeTruthy();
    for (const name of [
      "Payments",
      "Email",
      "SMS",
      "OTP",
      "Geocoding",
      "Google sign-in",
    ]) {
      expect(screen.getByRole("heading", { level: 3, name })).toBeTruthy();
      expect(
        screen.getByRole("link", { name: "Read the " + name + " guide" }),
      ).toBeTruthy();
    }
    expect(
      screen.queryByText(
        /Linkify|Trusted by the best|No credit card required|\/month/i,
      ),
    ).toBeNull();
  });

  it("keeps section navigation valid and provides distinct platform guide links", () => {
    const { container } = render(<PublicLandingPage />);

    const navigation = screen.getByRole("navigation", {
      name: "Main navigation",
    });
    for (const link of navigation.querySelectorAll("a")) {
      const target = link.getAttribute("href");
      expect(target?.startsWith("#")).toBe(true);
      expect(container.querySelector(target!)).toBeTruthy();
    }
    const platformLinks = screen.getAllByRole("link", { name: /^Read about / });
    expect(platformLinks).toHaveLength(4);
    for (const link of platformLinks) {
      expect(
        link
          .getAttribute("href")
          ?.startsWith("https://docs.apicenter.itsandbox.site/guides/"),
      ).toBe(true);
    }
    expect(
      new Set(platformLinks.map((link) => link.getAttribute("href"))).size,
    ).toBe(4);
  });
});
