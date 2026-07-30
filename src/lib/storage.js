import { supabase } from "../supabaseClient";

const TABLE = "kv_store";

// Pengganti window.storage dari environment Claude, dengan signature yang sama
// persis: get(key, shared), set(key, value, shared), delete(key, shared),
// list(prefix, shared). Backend-nya tabel key-value sederhana di Supabase.

export const storage = {
  async get(key, shared = false) {
    const { data, error } = await supabase
      .from(TABLE)
      .select("value")
      .eq("key", key)
      .eq("shared", shared)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return { key, value: data.value, shared };
  },

  async set(key, value, shared = false) {
    const { error } = await supabase
      .from(TABLE)
      .upsert({ key, value, shared, updated_at: new Date().toISOString() }, { onConflict: "key,shared" });
    if (error) throw error;
    return { key, value, shared };
  },

  async delete(key, shared = false) {
    const { error } = await supabase.from(TABLE).delete().eq("key", key).eq("shared", shared);
    if (error) throw error;
    return { key, deleted: true, shared };
  },

  async list(prefix = "", shared = false) {
    let query = supabase.from(TABLE).select("key").eq("shared", shared);
    if (prefix) query = query.like("key", `${prefix}%`);
    const { data, error } = await query;
    if (error) throw error;
    return { keys: (data || []).map((d) => d.key), prefix, shared };
  },
};
