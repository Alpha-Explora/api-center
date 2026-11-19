import { Controller, Get, Param, Res } from "@nestjs/common";
import type { Response } from "express";
import { PaymentReturnLinks } from "./payment-return-links";

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`);

const page = (title: string, body: string) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>${title}</title>
<style>body{font-family:system-ui,sans-serif;max-width:28rem;margin:4rem auto;padding:0 1rem;text-align:center;color:#1a1a1a}
a{display:inline-block;margin-top:1rem;padding:.75rem 1.25rem;border-radius:.5rem;background:#1a1a1a;color:#fff;text-decoration:none}</style>
</head><body>${body}</body></html>`;

/** The HTTPS page payment providers return customers to when the app gave its own link. */
@Controller("payment-return")
export class PaymentReturnController {
  constructor(private readonly links: PaymentReturnLinks) {}

  @Get(":token")
  forward(@Param("token") token: string, @Res() res: Response): void {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'");
    const target = this.links.target(token);
    if (!target) {
      res.status(400).type("html").send(page("Link not recognised",
        "<p>This payment return link is not valid. Go back to the app to check your payment.</p>"));
      return;
    }
    // The redirect opens the app; the button is for browsers that do not follow it.
    res.status(302).location(target).type("html").send(page("Returning to the app",
      `<p>Returning you to the app.</p><a href="${escapeHtml(target)}">Open the app</a>`));
  }
}
