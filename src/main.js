import * as f3 from "family-chart";
import "family-chart/styles/family-chart.css";
import "./style.css";
import { familyData } from "./data.js";

// ---------------------------------------------------------------------------
// 1. LINEAGE TOGGLE — decide which parent set to render
// ---------------------------------------------------------------------------
// family-chart's own `rels.parents` field is what actually gets drawn. We
// don't touch data.js directly — instead, every time the toggle changes, we
// build a fresh copy of the dataset where `rels.parents` is filled in from
// either `parents_bio` or `parents_adoptive`, whichever is selected.
let currentMode = "bio"; // "bio" | "adoptive"

function buildTreeData(mode) {
  // Clone everything up front so we can freely rewrite both sides of each
  // relationship (child -> parents AND parent -> children) without
  // mutating the original familyData.
  const clones = familyData.map((person) => structuredClone(person));
  const byId = new Map(clones.map((person) => [person.id, person]));

  clones.forEach((person) => {
    const bio = person.data.parents_bio;
    const adoptive = person.data.parents_adoptive;

    // People without dual-lineage fields (e.g. the grandparents) keep
    // whatever rels.parents they already had — nothing to do here.
    if (!bio?.length && !adoptive?.length) return;

    const active = mode === "adoptive" && adoptive?.length ? adoptive : bio || [];
    const allMentionedParentIds = new Set([...(bio || []), ...(adoptive || [])]);

    // For every parent NOT in the active set, remove this person from
    // that parent's `children` array — otherwise the library sees the
    // child claimed by parents on both sides at once and throws
    // "child has more than 1 parent".
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

// ---------------------------------------------------------------------------
// 2. CREATE THE CHART
// ---------------------------------------------------------------------------
const f3Chart = f3.createChart("#FamilyChart", buildTreeData(currentMode));

const f3Card = f3Chart
  .setCardHtml()
  .setCardDisplay([["first name", "last name"]])
  // Custom inner HTML for every card. This is where gender_identity gets
  // shown instead of the raw M/F, and where the "View Photos" button lives.
  .setCardInnerHtmlCreator((d) => {
    // `d` is the D3 tree node; the actual person fields we stored in
    // data.js live at d.data.data. If you find fields aren't lining up
    // once this is running in the browser, console.log(d) here to confirm
    // the exact shape — the library's nesting isn't fully documented.
    const person = d.data?.data || {};
    const id = d.data?.id;
    const name = `${person["first name"] || ""} ${person["last name"] || ""}`.trim();
    const identity = person.gender_identity || "";
    const photoCount = person.photos?.length || 0;

    return `
      <div class="card-inner">
        <div class="card-name">${name}</div>
        ${identity ? `<div class="card-identity">${identity}</div>` : ""}
        ${person.birthday ? `<div class="card-birthday">${person.birthday}</div>` : ""}
        ${
          photoCount > 0
            ? `<button class="card-photos-btn" data-person-id="${id}">📷 ${photoCount} photo${photoCount > 1 ? "s" : ""}</button>`
            : ""
        }
      </div>
    `;
  });

// Keep the library's default click behavior (expand/collapse the tree),
// but ALSO listen for clicks on our custom "View Photos" button and open
// the gallery modal instead of letting the click bubble into the default handler.
f3Card.setOnCardClick((e, d) => {
  const btn = e.target.closest(".card-photos-btn");
  if (btn) {
    e.stopPropagation();
    openGallery(btn.dataset.personId);
    return;
  }
  f3Card.onCardClickDefault(e, d); // fall back to normal expand/collapse
});

f3Chart.updateTree({ initial: true });

// ---------------------------------------------------------------------------
// 3. PHOTO GALLERY MODAL
// ---------------------------------------------------------------------------
const modal = document.getElementById("gallery-modal");
const galleryScroll = document.getElementById("gallery-scroll");
const galleryTitle = document.getElementById("gallery-title");
const galleryDesc = document.getElementById("gallery-desc");

function openGallery(personId) {
  const person = familyData.find((p) => p.id === personId)?.data;
  if (!person) return;

  galleryTitle.textContent = `${person["first name"]} ${person["last name"]}`;
  galleryDesc.textContent = person.description || "";

  galleryScroll.innerHTML = (person.photos || [])
    .map(
      (photo) => `
        <figure class="gallery-item">
          <img src="${photo.url}" alt="${photo.caption || ""}" loading="lazy" />
          <figcaption>${photo.caption || ""}</figcaption>
        </figure>
      `
    )
    .join("");

  modal.classList.remove("hidden");
}

document.getElementById("gallery-close").addEventListener("click", () => {
  modal.classList.add("hidden");
});
modal.addEventListener("click", (e) => {
  if (e.target === modal) modal.classList.add("hidden"); // click outside content closes it
});

// ---------------------------------------------------------------------------
// 4. TOGGLE BUTTON WIRING
// ---------------------------------------------------------------------------
document.getElementById("btn-bio").addEventListener("click", () => switchMode("bio"));
document.getElementById("btn-adoptive").addEventListener("click", () => switchMode("adoptive"));

function switchMode(mode) {
  currentMode = mode;
  document.getElementById("btn-bio").classList.toggle("active", mode === "bio");
  document.getElementById("btn-adoptive").classList.toggle("active", mode === "adoptive");

  f3Chart.updateData(buildTreeData(mode));
  f3Chart.updateTree({ initial: true });
}
