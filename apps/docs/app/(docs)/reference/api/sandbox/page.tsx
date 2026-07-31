import { ScalarApiReference } from "@/components/scalar-api-reference";

export const metadata = {
  title: "Interactive API Sandbox | APICenter",
  description: "Test APICenter REST endpoints live using the Scalar interactive sandbox.",
};

export default function SandboxPage() {
  return (
    <div style={{ width: "100%", height: "calc(100vh - 56px)" }}>
      <ScalarApiReference specUrl="/api/openapi.json" />
    </div>
  );
}
