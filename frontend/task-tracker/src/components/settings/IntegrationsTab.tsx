import GoogleCalendarCard from "./GoogleCalendarCard";

export default function IntegrationsTab() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 16,
        padding: 20,
      }}
    >
      <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>Integrations</h2>
      <GoogleCalendarCard />
    </div>
  );
}
