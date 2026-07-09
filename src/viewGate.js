import { supabase } from "./supabaseClient.js";

const SESSION_KEY = "family-tree-view-password";

const gateEl = document.getElementById("view-gate");
const appEl = document.getElementById("app");
const form = document.getElementById("view-gate-form");
const passwordInput = document.getElementById("view-gate-password");
const errorEl = document.getElementById("view-gate-error");

// Tries to fetch the tree with a given password. Returns the people array
// on success, or null on failure (and shows the error in the gate UI).
async function tryFetch(password) {
  const { data, error } = await supabase.rpc("get_people", { p_password: password });
  if (error) {
    errorEl.textContent = error.message;
    errorEl.classList.remove("hidden");
    return null;
  }
  errorEl.classList.add("hidden");
  return data;
}

/**
 * Resolves with the people array once the correct password has been entered
 * (or was already cached in this browser tab's session).
 */
export function requireViewAccess() {
  return new Promise((resolve) => {
    const cached = sessionStorage.getItem(SESSION_KEY);
    if (cached) {
      tryFetch(cached).then((data) => {
        if (data) {
          openApp();
          resolve(data);
        } else {
          sessionStorage.removeItem(SESSION_KEY);
          // fall through to showing the form (already visible by default)
        }
      });
    }

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const pw = passwordInput.value;
      const data = await tryFetch(pw);
      if (data) {
        sessionStorage.setItem(SESSION_KEY, pw);
        openApp();
        resolve(data);
      }
    });
  });
}

function openApp() {
  gateEl.classList.add("hidden");
  appEl.classList.remove("hidden");
}
