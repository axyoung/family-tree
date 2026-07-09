import * as f3 from "family-chart";
import "family-chart/styles/family-chart.css";
import "./style.css";
import { requestEditAccess } from "./editSession.js";
import { openEditForm } from "./editForm.js";
import { requireViewAccess } from "./viewGate.js";

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
        // this parent is the currently-active lineage for this child —
        // make sure the reciprocal link exists, regardless of what was
        // actually saved in the database
        if (!parentNode.rels.children.includes(person.id)) {
          parentNode.rels.children.push(person.id);
        }
      } else {
        // this parent belongs to the inactive lineage — hide the link
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
    .setAncestryDepth(20)
    .setProgenyDepth(20)
    .setShowSiblingsOfMain(true);

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
        peopleList: familyData,
        onSubmitted: () => showStatus("Submitted for approval — an admin will review it soon."),
        onDeleted: () => showStatus("Delete request submitted for approval."),
      });
      return;
    }
    // Keep the library's default behavior (re-centers the tree on this
    // person, revealing their relatives) AND open our detail side panel.
    f3Card.onCardClickDefault(e, d);
    openSidePanel(d.data?.id);
  });

  f3Chart.updateMainId(findRootPersonId());
  validateTreeData(buildTreeData(currentLineageMode));
  f3Chart.updateTree({ initial: true, tree_position: "fit" });
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
