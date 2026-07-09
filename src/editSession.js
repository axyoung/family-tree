import { supabase } from "./supabaseClient.js";

let cachedPassword = null;

export function clearCachedPassword() {
  cachedPassword = null;
}

export function hasCachedPassword() {
  return !!cachedPassword;
}

async function promptForPasswordIfNeeded() {
  if (cachedPassword) return cachedPassword;
  const pw = window.prompt("Enter the family edit password:");
  if (!pw) return null;
  cachedPassword = pw;
  return pw;
}

// Call this to gate entry into "edit mode" in the UI — asks for the
// password up front, before showing any edit buttons, so we're not
// asking mid-form.
export async function requestEditAccess() {
  return promptForPasswordIfNeeded();
}

export async function submitPendingEdit({
  editType,
  personId,
  payload,
  relationToId,
  relationType,
  submittedBy,
}) {
  const password = await promptForPasswordIfNeeded();
  if (!password) return { error: new Error("No password entered") };

  const { data, error } = await supabase.rpc("submit_pending_edit", {
    p_edit_type: editType,
    p_person_id: personId,
    p_payload: payload,
    p_password: password,
    p_relation_to_id: relationToId || null,
    p_relation_type: relationType || null,
    p_submitted_by: submittedBy || null,
  });

  if (error && /incorrect edit password/i.test(error.message)) {
    clearCachedPassword();
  }

  return { data, error };
}
