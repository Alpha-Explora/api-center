import { ScalarApiReference } from "@/components/scalar-api-reference";

export const metadata = {
  title: "Try it in the browser",
  description: "Send requests to the APICenter API from your browser with your test key.",
};

export default function SandboxPage() {
  return (
    <main className="flex-1">
      <ScalarApiReference specUrl="/api/openapi.json" />
    </main>
  );
}
