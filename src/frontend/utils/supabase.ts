import { createClient, SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL ?? "";
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? "";

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient | null {
  if (!supabaseUrl || !supabaseAnonKey) {
    return null;
  }
  if (!client) {
    client = createClient(supabaseUrl, supabaseAnonKey);
  }
  return client;
}

export function subscribeTable<T extends Record<string, unknown>>(
  table: "positions" | "debts" | "events",
  onSnapshot: (rows: T[]) => void
): () => void {
  const sb = getSupabase();
  if (!sb) return () => {};

  const fetchAll = async () => {
    const { data } = await sb.from(table).select("*");
    if (data) onSnapshot(data as T[]);
  };

  fetchAll();

  const channel = sb
    .channel(`public:${table}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table },
      () => {
        fetchAll();
      }
    )
    .subscribe();

  return () => {
    sb.removeChannel(channel);
  };
}

export async function pushDarkPatternEvent(
  type: "DOUBLE_INTEREST" | "SEND_ENFORCER" | "COLLECT_DEBT",
  traderId: string,
  message: string
): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  await sb.from("events").insert({ type, trader_id: traderId, message });
}
