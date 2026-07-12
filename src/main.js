import * as f3 from "family-chart";
import "family-chart/styles/family-chart.css";
import "./style.css";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { requestEditAccess } from "./editSession.js";
import { openEditForm } from "./editForm.js";
import { requireViewAccess, refetchPeople } from "./viewGate.js";
import { formatFullName } from "./nameUtils.js";
import { openQuickEdit, isQuickEditActive, cancelQuickEdit } from "./quickEditPanel.js";

// ---------------------------------------------------------------------------
// STATE
// ---------------------------------------------------------------------------
let familyData = []; // loaded once the view password is verified
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

function normalizeRels(rawPeople) {
  return (rawPeople || []).map((person) => ({
    ...person,
    rels: {
      spouses: person.rels?.spouses || [],
      children: person.rels?.children || [],
      parents: person.rels?.parents || [],
    },
  }));
}

// Adds/updates apply immediately server-side now — refetch so the tree
// reflects the change without a manual page reload.
async function refreshAfterEdit() {
  const rawPeople = await refetchPeople();
  if (!rawPeople) return;
  familyData = normalizeRels(rawPeople);
  rerenderTree();
  populateJumpToPerson();
}

// The library defaults to centering on whichever person happens to be first
// in the data array — usually not what you want. Instead, anchor on
// whichever no-recorded-parents person has the MOST descendants under the
// current lineage mode, so switching modes can never land on a near-empty
// branch (e.g. an adoptive parent who has no other visible relatives).
function findRootPersonId() {
  const treeData = buildTreeData(currentLineageMode);
  const byId = new Map(treeData.map((p) => [p.id, p]));

  const rootCandidates = treeData.filter(
    (p) =>
      !(p.data.parents_bio?.length) &&
      !(p.data.parents_adoptive?.length) &&
      !(p.rels.parents?.length)
  );
  if (!rootCandidates.length) return familyData[0]?.id;

  function countDescendants(id, visited) {
    if (visited.has(id)) return 0;
    visited.add(id);
    const node = byId.get(id);
    if (!node) return 0;
    let count = 1;
    (node.rels.children || []).forEach((childId) => {
      count += countDescendants(childId, visited);
    });
    return count;
  }

  let best = rootCandidates[0];
  let bestCount = -1;
  rootCandidates.forEach((candidate) => {
    const count = countDescendants(candidate.id, new Set());
    if (count > bestCount) {
      bestCount = count;
      best = candidate;
    }
  });
  return best.id;
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
      const parentNode = byId.get(parentId);
      if (!parentNode?.rels) return;
      parentNode.rels.children = parentNode.rels.children || [];

      if (active.includes(parentId)) {
        if (!parentNode.rels.children.includes(person.id)) {
          parentNode.rels.children.push(person.id);
        }
      } else {
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
  const data = buildTreeData(currentLineageMode);
  validateTreeData(data);
  f3Chart.updateData(data);
  f3Chart.updateTree({ initial: true });
}

// Logs exactly which person and which parents are conflicting, since the
// library's own error ("child has more than 1 parent") doesn't say who.
function validateTreeData(clones) {
  const childToParents = new Map();
  clones.forEach((person) => {
    (person.rels.children || []).forEach((childId) => {
      if (!childToParents.has(childId)) childToParents.set(childId, []);
      childToParents.get(childId).push(person.id);
    });
  });
  childToParents.forEach((parents, childId) => {
    if (parents.length > 2) {
      const childName = clones.find((p) => p.id === childId)?.data?.["first name"] || childId;
      console.error(
        `DATA CONFLICT: "${childName}" (id: ${childId}) is listed as a child of ${parents.length} people:`,
        parents.map((pid) => `${pid} (${clones.find((p) => p.id === pid)?.data?.["first name"] || "?"})`)
      );
    }
  });
}

// ---------------------------------------------------------------------------
// 3. CHART SETUP
// ---------------------------------------------------------------------------
async function init() {
  const rawPeople = await requireViewAccess(); // blocks until password verified
  familyData = normalizeRels(rawPeople);

  f3Chart = f3.createChart("#FamilyChart", buildTreeData(currentLineageMode));
  f3Chart
    .setAncestryDepth(50)
    .setProgenyDepth(50)
    .setShowSiblingsOfMain(true)
    .setSingleParentEmptyCard(false); // don't auto-insert placeholder "Unknown" spouse cards

  f3Card = f3Chart
    .setCardHtml()
    .setMiniTree(true) // shows a small indicator on cards with hidden relatives
    .setCardDim({ width: 240, height: 100 })
    .setCardDisplay([["first name", "last name"]])
    .setCardInnerHtmlCreator((d) => {
      const person = d.data?.data || {};
      const identity = person.gender_identity || "";

      const lifespan = person.birthday || person.date_of_death
        ? `${person.birthday || "?"}${person.date_of_death ? ` – ${person.date_of_death}` : ""}`
        : "";

      return `
        <div class="card-inner">
          ${
            person.avatar
              ? `<img class="card-avatar" src="${person.avatar}" alt="" />`
              : `<div class="card-avatar card-avatar-placeholder"></div>`
          }
          <div class="card-text">
            <div class="card-name">${formatFullName(person)}</div>
            ${identity ? `<div class="card-identity">${identity}</div>` : ""}
            ${lifespan ? `<div class="card-birthday">${lifespan}</div>` : ""}
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
        peopleList: familyData,
        onSubmitted: async () => {
          showStatus("Saved.");
          await refreshAfterEdit();
        },
        onDeleted: () => showStatus("Delete request submitted for admin approval."),
      });
      return;
    }
    // Keep the library's default behavior (re-centers the tree on this
    // person, revealing their relatives) AND open our detail side panel.
    f3Card.onCardClickDefault(e, d);
    openSidePanel(d.data?.id);
    // Wait a frame so the panel's width change has actually reflowed the
    // tree container before re-fitting — fitting immediately would still
    // measure the OLD (wider) width.
    requestAnimationFrame(() => {
      f3Chart.updateTree({ tree_position: "fit" });
    });
  });

  f3Chart.updateMainId(findRootPersonId());
  validateTreeData(buildTreeData(currentLineageMode));
  f3Chart.updateTree({ initial: true, tree_position: "fit" });

  populateJumpToPerson();
}

function populateJumpToPerson() {
  const sorted = [...familyData].sort((a, b) =>
    formatFullName(a.data).localeCompare(formatFullName(b.data))
  );
  const select = document.getElementById("jump-to-person");
  select.innerHTML =
    `<option value="">Jump to person…</option>` +
    sorted
      .map((p) => `<option value="${p.id}">${formatFullName(p.data) || p.id}</option>`)
      .join("");
}

document.getElementById("jump-to-person").addEventListener("change", (e) => {
  const id = e.target.value;
  if (!id) return;
  f3Chart.updateMainId(id);
  openSidePanel(id);
  requestAnimationFrame(() => {
    f3Chart.updateTree({ tree_position: "fit" });
  });
  e.target.value = "";
});

// ---------------------------------------------------------------------------
// 4. PERSON DETAIL SIDE PANEL (docked, not an overlay)
// ---------------------------------------------------------------------------
const sidePanel = document.getElementById("side-panel");
const sidePanelAvatar = document.getElementById("side-panel-avatar");
const sidePanelTitle = document.getElementById("side-panel-title");
const sidePanelIdentity = document.getElementById("side-panel-identity");
const sidePanelBirthday = document.getElementById("side-panel-birthday");
const sidePanelMaiden = document.getElementById("side-panel-maiden");
const sidePanelDesc = document.getElementById("side-panel-desc");
const sidePanelPhotos = document.getElementById("side-panel-photos");
const sidePanelEditBtn = document.getElementById("side-panel-edit-btn");

let currentSidePanelPersonId = null;

// Computes this person's parents/spouses/siblings/step-siblings under the
// CURRENT lineage mode, so the listing matches what the toggle is showing.
function computeRelationships(personId) {
  const treeData = buildTreeData(currentLineageMode);
  const byId = new Map(treeData.map((p) => [p.id, p]));
  const person = byId.get(personId);
  if (!person) return { parents: [], spouses: [], siblings: [], stepSiblings: [] };

  const parentIds = person.rels.parents || [];
  const spouseIds = person.rels.spouses || [];

  const siblingIds = new Set();
  treeData.forEach((p) => {
    if (p.id === personId) return;
    if ((p.rels.parents || []).some((pid) => parentIds.includes(pid))) siblingIds.add(p.id);
  });

  // Step-siblings: children of one of this person's parent's OTHER spouses
  // (a step-parent), who aren't already a full/half sibling.
  const stepParentIds = new Set();
  parentIds.forEach((pid) => {
    (byId.get(pid)?.rels.spouses || []).forEach((sid) => {
      if (!parentIds.includes(sid)) stepParentIds.add(sid);
    });
  });
  const stepSiblingIds = new Set();
  stepParentIds.forEach((spid) => {
    (byId.get(spid)?.rels.children || []).forEach((cid) => {
      if (cid !== personId && !siblingIds.has(cid)) stepSiblingIds.add(cid);
    });
  });

  const toPeople = (ids) => [...ids].map((id) => byId.get(id)).filter(Boolean);

  // Biological/adoptive parents and children — read directly from the raw
  // parents_bio/parents_adoptive fields, NOT from buildTreeData's output.
  // buildTreeData intentionally falls back to bio parents under adoptive
  // mode when someone has no real adoptive parents set (so the tree still
  // renders them somewhere) — but that fallback isn't a real adoptive
  // relationship, so using it here would incorrectly count ordinary
  // biological parents/children as "adoptive."
  const rawPerson = familyData.find((p) => p.id === personId);
  const bioParentIds = rawPerson?.data.parents_bio || [];
  const adoptiveParentIds = rawPerson?.data.parents_adoptive || [];
  const childrenIds = familyData.filter((p) => (p.data.parents_bio || []).includes(personId)).map((p) => p.id);
  const adoptedChildrenIds = familyData
    .filter((p) => (p.data.parents_adoptive || []).includes(personId))
    .map((p) => p.id);

  return {
    bioParents: toPeople(bioParentIds),
    adoptiveParents: toPeople(adoptiveParentIds),
    spouses: toPeople(spouseIds),
    children: toPeople(childrenIds),
    adoptedChildren: toPeople(adoptedChildrenIds),
    siblings: toPeople(siblingIds),
    stepSiblings: toPeople(stepSiblingIds),
  };
}

function renderRelationshipsList(label, people) {
  if (!people.length) return "";
  const links = people
    .map(
      (p) =>
        `<button type="button" class="relationship-link" data-person-id="${p.id}">${formatFullName(p.data) || p.id}</button>`
    )
    .join(", ");
  return `<p class="side-panel-relationship-row"><strong>${label}:</strong> ${links}</p>`;
}

function openSidePanel(personId) {
  const person = familyData.find((p) => p.id === personId)?.data;
  if (!person) return;

  currentSidePanelPersonId = personId;

  document.getElementById("edit-modal")?.classList.add("hidden");
  document.getElementById("panel-quick-edit")?.classList.add("hidden");
  document.getElementById("panel-view")?.classList.remove("hidden");

  if (person.avatar) {
    sidePanelAvatar.src = person.avatar;
    sidePanelAvatar.classList.remove("hidden");
  } else {
    sidePanelAvatar.classList.add("hidden");
  }

  sidePanelTitle.textContent = formatFullName(person);
  sidePanelIdentity.textContent = person.gender_identity || "";
  sidePanelBirthday.textContent = person.birthday || person.date_of_death
    ? `${person.birthday || "?"}${person.date_of_death ? ` – ${person.date_of_death}` : ""}`
    : "";
  sidePanelMaiden.textContent = person.maiden_name ? `Maiden name: ${person.maiden_name}` : "";
  sidePanelDesc.innerHTML = DOMPurify.sanitize(marked.parse(person.description || ""));

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

  const rel = computeRelationships(personId);
  const relationshipsEl = document.getElementById("side-panel-relationships");
  relationshipsEl.innerHTML =
    renderRelationshipsList("Biological parents", rel.bioParents) +
    renderRelationshipsList("Adoptive parents", rel.adoptiveParents) +
    renderRelationshipsList("Spouse(s)", rel.spouses) +
    renderRelationshipsList("Children", rel.children) +
    renderRelationshipsList("Adopted children", rel.adoptedChildren) +
    renderRelationshipsList("Siblings", rel.siblings) +
    renderRelationshipsList("Step-siblings", rel.stepSiblings);

  relationshipsEl.querySelectorAll(".relationship-link").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.personId;
      f3Chart.updateMainId(id);
      openSidePanel(id);
      requestAnimationFrame(() => f3Chart.updateTree({ tree_position: "fit" }));
    });
  });

  sidePanelEditBtn.classList.toggle("hidden", !editModeEnabled);
  sidePanel.classList.remove("hidden");
}

sidePanelEditBtn.addEventListener("click", () => {
  const person = familyData.find((p) => p.id === currentSidePanelPersonId);
  if (!person) return;
  openQuickEdit(person, async () => {
    showStatus("Saved.");
    await refreshAfterEdit();
    openSidePanel(currentSidePanelPersonId); // refresh the view with the new data
  });
});

function refitTree() {
  if (f3Chart) f3Chart.updateTree({ tree_position: "fit" });
}

document.getElementById("side-panel-close").addEventListener("click", () => {
  if (isQuickEditActive()) {
    cancelQuickEdit();
  }
  sidePanel.classList.add("hidden");
  requestAnimationFrame(refitTree);
});

// The edit form (editForm.js) dispatches this when it closes, so we can
// refit the tree once that panel's space is actually freed up.
window.addEventListener("family-tree:layout-changed", () => {
  requestAnimationFrame(refitTree);
});

// --- Resizable panels (both the view panel and the edit panel share the
// same remembered width, since only one is ever shown at a time) ---
const savedWidth = localStorage.getItem("family-tree-panel-width");
function applySavedWidth(panelEl) {
  if (savedWidth) panelEl.style.width = `${savedWidth}px`;
}
applySavedWidth(sidePanel);
applySavedWidth(document.getElementById("edit-modal"));

function setupResizeHandle(handleEl, panelEl) {
  let isResizing = false;

  handleEl.addEventListener("mousedown", (e) => {
    isResizing = true;
    handleEl.classList.add("dragging");
    e.preventDefault();
  });

  window.addEventListener("mousemove", (e) => {
    if (!isResizing) return;
    const newWidth = Math.min(Math.max(window.innerWidth - e.clientX, 280), window.innerWidth * 0.85);
    panelEl.style.width = `${newWidth}px`;
  });

  window.addEventListener("mouseup", () => {
    if (!isResizing) return;
    isResizing = false;
    handleEl.classList.remove("dragging");
    localStorage.setItem("family-tree-panel-width", parseInt(panelEl.style.width, 10));
    refitTree();
  });
}

setupResizeHandle(document.getElementById("side-panel-resize-handle"), sidePanel);
setupResizeHandle(document.getElementById("edit-modal-resize-handle"), document.getElementById("edit-modal"));

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

document.getElementById("btn-reset-view").addEventListener("click", () => {
  f3Chart.updateMainId(findRootPersonId());
  f3Chart.updateTree({ tree_position: "fit" });
});

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

  editModeEnabled = true;
  editModeBtn.textContent = "Edit mode: On";
  addPersonBtn.classList.remove("hidden");
  rerenderTree();
});

addPersonBtn.addEventListener("click", () => {
  openEditForm({
    mode: "add",
    peopleList: familyData,
    onSubmitted: async () => {
      showStatus("Saved.");
      await refreshAfterEdit();
    },
  });
});

init();