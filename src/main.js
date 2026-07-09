import * as f3 from "family-chart";
import "family-chart/styles/family-chart.css";
import "./style.css";
import { supabase } from "./supabaseClient.js";
import { requestEditAccess } from "./editSession.js";
import { openEditForm } from "./editForm.js";

// ---------------------------------------------------------------------------
// STATE
// ---------------------------------------------------------------------------
let familyData = []; // loaded from Supabase on init
let currentLineageMode = "bio"; // "bio" | "adoptive"
let editModeEnabled = false;
let f3Chart = null;
let f3Card = null;

const statusBanner = document.getElementById("status-banner");
function showStatus(message, isError = false) {
  statusBanner.textContent = message;
  statusBanner.classList.remove("hidden");
  statusBanner.classList.toggle("status-error", isError);
  if (!isError) {
    setTimeout(() => statusBanner.classList.add("hidden"), 4000);
  }
}

// ---------------------------------------------------------------------------
// 1. LOAD DATA FROM SUPABASE
// ---------------------------------------------------------------------------
async function loadFamilyData() {
  const { data, error } = await supabase.from("people").select("id, data, rels");
  if (error) {
    showStatus(`Failed to load family data: ${error.message}`, true);
    return [];
  }
  return (data || []).map((person) => ({
    ...person,
    rels: {
      spouses: person.rels?.spouses || [],
      children: person.rels?.children || [],
      parents: person.rels?.parents || [],
    },
  }));
}

// ---------------------------------------------------------------------------
// 2. LINEAGE TOGGLE — decide which parent set to render
// ---------------------------------------------------------------------------
function buildTreeData(mode) {
  const clones = familyData.map((person) => structuredClone(person));
  const byId = new Map(clones.map((person) => [person.id, person]));

  clones.forEach((person) => {
    const bio = person.data.parents_bio;
    const adoptive = person.data.parents_adoptive;
    if (!bio?.length && !adoptive?.length) return;

    const active = mode === "adoptive" && adoptive?.length ? adoptive : bio || [];
    const allMentionedParentIds = new Set([...(bio || []), ...(adoptive || [])]);

    allMentionedParentIds.forEach((parentId) => {
      if (active.includes(parentId)) return;
      const parentNode = byId.get(parentId);
      if (parentNode?.rels?.children) {
        parentNode.rels.children = parentNode.rels.children.filter(
          (childId) => childId !== person.id
        );
      }
    });

    person.rels.parents = active;
  });

  return clones;
}

function rerenderTree() {
  f3Chart.updateData(buildTreeData(currentLineageMode));
  f3Chart.updateTree({ initial: true });
}

// ---------------------------------------------------------------------------
// 3. CHART SETUP
// ---------------------------------------------------------------------------
async function init() {
  familyData = await loadFamilyData();

  f3Chart = f3.createChart("#FamilyChart", buildTreeData(currentLineageMode));

  f3Card = f3Chart
    .setCardHtml()
    .setCardDim({ width: 240, height: 100 })
    .setCardDisplay([["first name", "last name"]])
    .setCardInnerHtmlCreator((d) => {
      const person = d.data?.data || {};
      const identity = person.gender_identity || "";

      return `
        <div class="card-inner">
          ${
            person.avatar
              ? `<img class="card-avatar" src="${person.avatar}" alt="" />`
              : `<div class="card-avatar card-avatar-placeholder"></div>`
          }
          <div class="card-text">
            <div class="card-name">${person["first name"] || ""} ${person["last name"] || ""}</div>
            ${identity ? `<div class="card-identity">${identity}</div>` : ""}
            ${person.birthday ? `<div class="card-birthday">${person.birthday}</div>` : ""}
          </div>
          ${editModeEnabled ? `<button class="card-edit-btn" data-person-id="${d.data?.id}">✏️</button>` : ""}
        </div>
      `;
    });

  f3Card.setOnCardClick((e, d) => {
    const editBtn = e.target.closest(".card-edit-btn");
    if (editBtn) {
      e.stopPropagation();
      const person = familyData.find((p) => p.id === editBtn.dataset.personId);
      openEditForm({
        mode: "update",
        person,
        onSubmitted: () => showStatus("Submitted for approval — an admin will review it soon."),
      });
      return;
    }
    // Keep the library's default behavior (re-centers the tree on this
    // person, revealing their relatives) AND open our detail side panel.
    f3Card.onCardClickDefault(e, d);
    openSidePanel(d.data?.id);
  });

  f3Chart.updateTree({ initial: true });
}

// ---------------------------------------------------------------------------
// 4. PERSON DETAIL SIDE PANEL
// ---------------------------------------------------------------------------
const sidePanel = document.getElementById("side-panel");
const sidePanelBackdrop = document.getElementById("side-panel-backdrop");
const sidePanelAvatar = document.getElementById("side-panel-avatar");
const sidePanelTitle = document.getElementById("side-panel-title");
const sidePanelIdentity = document.getElementById("side-panel-identity");
const sidePanelBirthday = document.getElementById("side-panel-birthday");
const sidePanelDesc = document.getElementById("side-panel-desc");
const sidePanelPhotos = document.getElementById("side-panel-photos");

function openSidePanel(personId) {
  const person = familyData.find((p) => p.id === personId)?.data;
  if (!person) return;

  if (person.avatar) {
    sidePanelAvatar.src = person.avatar;
    sidePanelAvatar.classList.remove("hidden");
  } else {
    sidePanelAvatar.classList.add("hidden");
  }

  sidePanelTitle.textContent = `${person["first name"] || ""} ${person["last name"] || ""}`.trim();
  sidePanelIdentity.textContent = person.gender_identity || "";
  sidePanelBirthday.textContent = person.birthday || "";
  sidePanelDesc.textContent = person.description || "";

  sidePanelPhotos.innerHTML = (person.photos || [])
    .map(
      (photo) => `
        <figure class="gallery-item">
          <img src="${photo.url}" alt="${photo.caption || ""}" loading="lazy" />
          <figcaption>${photo.caption || ""}</figcaption>
        </figure>
      `
    )
    .join("");

  sidePanel.classList.remove("hidden");
  sidePanelBackdrop.classList.remove("hidden");
  requestAnimationFrame(() => sidePanel.classList.add("open"));
}

function closeSidePanel() {
  sidePanel.classList.remove("open");
  sidePanelBackdrop.classList.add("hidden");
  setTimeout(() => sidePanel.classList.add("hidden"), 250);
}

document.getElementById("side-panel-close").addEventListener("click", closeSidePanel);
sidePanelBackdrop.addEventListener("click", closeSidePanel);

// ---------------------------------------------------------------------------
// 5. LINEAGE TOGGLE BUTTON WIRING
// ---------------------------------------------------------------------------
document.getElementById("btn-bio").addEventListener("click", () => switchLineageMode("bio"));
document.getElementById("btn-adoptive").addEventListener("click", () => switchLineageMode("adoptive"));

function switchLineageMode(mode) {
  currentLineageMode = mode;
  document.getElementById("btn-bio").classList.toggle("active", mode === "bio");
  document.getElementById("btn-adoptive").classList.toggle("active", mode === "adoptive");
  rerenderTree();
}

// ---------------------------------------------------------------------------
// 6. EDIT MODE GATE + ADD PERSON BUTTON
// ---------------------------------------------------------------------------
const editModeBtn = document.getElementById("btn-edit-mode");
const addPersonBtn = document.getElementById("btn-add-person");

editModeBtn.addEventListener("click", async () => {
  if (editModeEnabled) {
    editModeEnabled = false;
    editModeBtn.textContent = "Edit mode: Off";
    addPersonBtn.classList.add("hidden");
    rerenderTree();
    return;
  }

  const password = await requestEditAccess();
  if (!password) return; // user cancelled the password prompt

  // We don't actually validate the password here — the server-side RPC
  // validates it on the first real submission. Entering edit mode just
  // reveals the edit buttons; a wrong password will simply fail later
  // with a clear error when they try to submit something.
  editModeEnabled = true;
  editModeBtn.textContent = "Edit mode: On";
  addPersonBtn.classList.remove("hidden");
  rerenderTree();
});

addPersonBtn.addEventListener("click", () => {
  openEditForm({
    mode: "add",
    peopleList: familyData,
    onSubmitted: () => showStatus("Submitted for approval — an admin will review it soon."),
  });
});

init();
