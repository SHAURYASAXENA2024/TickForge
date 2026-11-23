/** Shown only while the exchange-api or the engine cannot be reached. It clears itself when the poll succeeds again. */
export function ConnectionBanner({ online, engineConnected, lastUpdated }: { online: boolean; engineConnected: boolean; lastUpdated: Date | null }) {
  if (online && engineConnected) return null;
  const text = !online
    ? "Connection lost: the exchange-api is not reachable. Retrying every few seconds."
    : "The matching engine is not reachable. Retrying every few seconds.";
  return (
    <div role="alert" className="border-b border-line bg-raised px-4 py-2 text-center text-sm text-down">
      {text} {lastUpdated ? `Last updated ${lastUpdated.toLocaleTimeString()}.` : "No data received yet."}
    </div>
  );
}
