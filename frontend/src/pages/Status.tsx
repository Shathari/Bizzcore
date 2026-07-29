import { LegalLayout } from "../components/LegalLayout";

// Placeholder — no uptime-monitoring infrastructure exists yet, so this
// deliberately doesn't claim a live "all systems operational" state.
export default function Status() {
  return (
    <LegalLayout title="Status">
      <p>
        A live status page isn't set up yet. If you're running into an issue with BizzCore right now,
        the fastest way to reach us is via the contact details on our homepage.
      </p>
    </LegalLayout>
  );
}
