import { supabase } from "./supabaseClient.js";

let cachedPassword = null;

export function clearCachedPassword() {
  cachedPassword = null;
}

export function hasCachedPassword() {
  return !!cachedPassword;
}

async function isAdminLoggedIn() {
  const { data: { session } } = await supabase.auth.getSession();
  return !!session;
}

async function promptForPasswordIfNeeded() {
  if (await isAdminLoggedIn()) return "__admin__"; // sentinel; server ignores this when authenticated
  if (cachedPassword) return cachedPassword;
  const pw = window.prompt("Enter the family edit password:");
  if (!pw) return null;
  cachedPassword = pw;
  return pw;
}

// Call this to gate entry into "edit mode" in the UI — verifies the
// password server-side up front (or admin login), so a wrong password
// can't get into edit mode at all, rather than only failing at submit time.
export async function requestEditAccess() {
  if (await isAdminLoggedIn()) return "__admin__";

  while (true) {
    const pw = window.prompt("Enter the family edit password:");
    if (!pw) return null; // user cancelled

    const { data: isValid, error } = await supabase.rpc("verify_edit_password", { p_password: pw });
    if (error) {
      alert(`Couldn't verify password: ${error.message}`);
      return null;
    }
    if (isValid) {
      cachedPassword = pw;
      return pw;
    }
    if (!confirm("Incorrect password. Try again?")) return null;
  }
}

export async function submitPendingEdit({
  editType,
  personId,
  payload,
  relations,
  relationsRemove,
  submittedBy,
}) {
  const password = await promptForPasswordIfNeeded();
  if (!password) return { error: new Error("No password entered") };

  const { data, error } = await supabase.rpc("submit_pending_edit", {
    p_edit_type: editType,
    p_person_id: personId,
    p_payload: payload,
    p_password: password === "__admin__" ? null : password,
    p_relations: relations || null,
    p_relations_remove: relationsRemove || null,
    p_submitted_by: submittedBy || null,
  });

  if (error && /incorrect edit password/i.test(error.message)) {
    clearCachedPassword();
  }

  return { data, error };
}
