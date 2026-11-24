import { useEffect, useState, useSyncExternalStore } from "react";
import { getDispatch, getExchangeHealth, getRecentTrades, getTraders, watchTraders, watchTrades, type DispatchInfo, type ExchangeHealth, type LiveTrade, type Trader } from "@/lib/exchangeApi";

const MAX_TRADES = 200;

// The dispatch field rides along with the traders update. It is kept here so ExchangeSection can read it
// without a new prop (the parent is unchanged).
let dispatchInfo: DispatchInfo | undefined;
const dispatchListeners = new Set<() => void>();
const setDispatch = (d: DispatchInfo | undefined) => {
  if (JSON.stringify(d) === JSON.stringify(dispatchInfo)) return;
  dispatchInfo = d;
  dispatchListeners.forEach((l) => l());
};
const subscribeDispatch = (l: () => void) => {
  dispatchListeners.add(l);
  return () => void dispatchListeners.delete(l);
};

/** The dispatch mode, turn count and next trader, or undefined while unknown (or from an older API). */
export const useDispatchInfo = () => useSyncExternalStore(subscribeDispatch, () => dispatchInfo, () => dispatchInfo);

/** Health, the 24 traders and the recent trades from exchange-api. `online` is false until the first answer. */
export function useExchange() {
  const [health, setHealth] = useState<ExchangeHealth | null>(null);
  const [online, setOnline] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [traders, setTraders] = useState<Trader[]>([]);
  const [trades, setTrades] = useState<LiveTrade[]>([]);

  useEffect(() => {
    const poll = async () => {
      try {
        setHealth(await getExchangeHealth());
        setOnline(true);
        setLastUpdated(new Date());
      } catch {
        setOnline(false);
        setHealth(null);
      }
    };
    poll();
    const timer = window.setInterval(poll, 5000);

    getRecentTrades(50).then(setTrades).catch(() => {});
    getTraders().then(setTraders).catch(() => {});
    getDispatch().then(setDispatch).catch(() => {});
    const stopTrades = watchTrades(
      (trade) => setTrades((prev) => [trade, ...prev].slice(0, MAX_TRADES)),
      (history) => setTrades(history),
    );
    const stopTraders = watchTraders((t, d) => {
      setTraders(t);
      setDispatch(d);
    });
    return () => {
      window.clearInterval(timer);
      stopTrades();
      stopTraders();
    };
  }, []);

  return { health, online, traders, trades, lastUpdated };
}
