import { isSupabaseConfigured, supabase } from "./supabaseClient";

export async function createTournamentInDb(tournament) {
  if (!isSupabaseConfigured) {
    return { data: null, error: new Error("Supabase is not configured") };
  }

  const { data, error } = await supabase
    .from("tournaments")
    .insert({
      name: tournament.name,
      data: tournament,
    })
    .select("id, name, data, created_at, updated_at")
    .single();

  return { data, error };
}

export async function updateTournamentInDb(tournament) {
  if (!isSupabaseConfigured) {
    return { data: null, error: new Error("Supabase is not configured") };
  }

  if (!tournament.remoteId) {
    return { data: null, error: new Error("Missing remoteId") };
  }

  const { data, error } = await supabase
    .from("tournaments")
    .update({
      name: tournament.name,
      data: tournament,
      updated_at: new Date().toISOString(),
    })
    .eq("id", tournament.remoteId)
    .select("id, name, data, created_at, updated_at")
    .single();

  return { data, error };
}

export async function loadTournamentFromDb(remoteId) {
  if (!isSupabaseConfigured) {
    return { data: null, error: new Error("Supabase is not configured") };
  }

  const { data, error } = await supabase
    .from("tournaments")
    .select("id, name, data, created_at, updated_at")
    .eq("id", remoteId)
    .single();

  return { data, error };
}