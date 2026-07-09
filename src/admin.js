import { supabase } from "./supabaseClient.js";
import "./style.css";

const loginSection = document.getElementById("login-section");
const pendingSection = document.getElementById("pending-section");
const loginForm = document.getElementById("login-form");
const loginError = document.getElementById("login-error");
const pendingList = document.getElementById("pending-list");
const pendingCount = document.getElementById("pending-count");

async function init() {
  const { data: { session } } = await supabase.auth.getSession();
  if (session) {
    showPendingSection();
  } else {
    showLoginSection();
  }
}

function showLoginSection() {
  loginSection.classList.remove("hidden");
  pendingSection.classList.add("hidden");
}

function showPendingSection() {
  loginSection.classList.add("hidden");
  pendingSection.classList.remove("hidden");
  loadPendingEdits();
}

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = document.getElementById("login-email").value;
  const password = document.getElementById("login-password").value;

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    loginError.textContent = error.message;
    loginError.classList.remove("hidden");
    return;
  }
  loginError.classList.add("hidden");
  showPendingSection();
});

document.getElementById("btn-logout").addEventListener("click", async () => {
  await supabase.auth.signOut();
  showLoginSection();
});

async function loadPendingEdits() {
  pendingList.innerHTML = "Loading…";

  const { data: edits, error } = await supabase
    .from("pending_edits")
    .select("*")
    .eq("status", "pending")
    .order("submitted_at", { ascending: false });

  if (error) {
    pendingList.innerHTML = `<p class="error">Failed to load: ${error.message}</p>`;
    return;
  }

  if (!edits.length) {
    pendingCount.textContent = "No pending edits — all caught up.";
    pendingList.innerHTML = "";
    return;
  }

  pendingCount.textContent = `${edits.length} pending edit${edits.length > 1 ? "s" : ""}`;

  // Look up display names for anyone referenced as a "relation_to" target,
  // so we can show "Add as child of: Lin Nguyen" instead of a raw ID.
  const relationIds = [...new Set(edits.map((e) => e.relation_to_id).filter(Boolean))];
  let relationNames = {};
  if (relationIds.length) {
    const { data: people } = await supabase.from("people").select("id, data").in("id", relationIds);
    relationNames = Object.fromEntries(
      (people || []).map((p) => [p.id, `${p.data["first name"] || ""} ${p.data["last name"] || ""}`.trim()])
    );
  }

  pendingList.innerHTML = "";
  edits.forEach((edit) => {
    const card = document.createElement("div");
    card.className = "pending-card";

    const d = edit.payload.data || {};
    const name = `${d["first name"] || ""} ${d["last name"] || ""}`.trim();
    const photoCount = d.photos?.length || 0;

    const relationLine =
      edit.edit_type === "add" && edit.relation_to_id
        ? `<p><strong>Relation:</strong> ${edit.relation_type} of ${relationNames[edit.relation_to_id] || edit.relation_to_id}</p>`
        : "";

    card.innerHTML = `
      <h3>${edit.edit_type === "add" ? "New person" : "Update"}: ${name || edit.person_id}</h3>
      ${relationLine}
      ${d.gender_identity ? `<p><strong>Gender identity:</strong> ${d.gender_identity}</p>` : ""}
      ${d.birthday ? `<p><strong>Birthday:</strong> ${d.birthday}</p>` : ""}
      ${d.description ? `<p><strong>Description:</strong> ${d.description}</p>` : ""}
      <p><strong>Photos:</strong> ${photoCount}</p>
      ${
        photoCount
          ? `<div class="pending-photo-strip">${d.photos
              .map((p) => `<img src="${p.url}" alt="${p.caption || ""}" />`)
              .join("")}</div>`
          : ""
      }
      <p class="submitted-meta">Submitted ${edit.submitted_by ? `by ${edit.submitted_by} ` : ""}on ${new Date(edit.submitted_at).toLocaleString()}</p>
      <div class="pending-actions">
        <button class="approve-btn" data-id="${edit.id}">Approve</button>
        <button class="reject-btn" data-id="${edit.id}">Reject</button>
      </div>
    `;
    pendingList.appendChild(card);
  });

  pendingList.querySelectorAll(".approve-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      const { error } = await supabase.rpc("approve_pending_edit", { p_edit_id: btn.dataset.id });
      if (error) {
        alert(`Approval failed: ${error.message}`);
        btn.disabled = false;
        return;
      }
      loadPendingEdits();
    });
  });

  pendingList.querySelectorAll(".reject-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      const { error } = await supabase.rpc("reject_pending_edit", { p_edit_id: btn.dataset.id });
      if (error) {
        alert(`Reject failed: ${error.message}`);
        btn.disabled = false;
        return;
      }
      loadPendingEdits();
    });
  });
}

init();
