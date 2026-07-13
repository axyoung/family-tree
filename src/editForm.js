import { submitPendingEdit } from "./editSession.js";
import { formatFullName } from "./nameUtils.js";
import { createPhotoFieldsController } from "./photoFieldsController.js";

const modal = document.getElementById("edit-modal");
const form = document.getElementById("edit-form");
const titleEl = document.getElementById("edit-modal-title");
const relationSection = document.getElementById("relation-fields");
const relationsListEl = document.getElementById("relations-list");
const addRelationRowBtn = document.getElementById("add-relation-row-btn");
const bioParent1Sel = document.getElementById("field-bio-parent-1");
const bioParent2Sel = document.getElementById("field-bio-parent-2");
const adoptiveParent1Sel = document.getElementById("field-adoptive-parent-1");
const adoptiveParent2Sel = document.getElementById("field-adoptive-parent-2");
const firstNameInput = document.getElementById("field-first-name");
const middleNameInput = document.getElementById("field-middle-name");
const lastNameInput = document.getElementById("field-last-name");
const maidenNameInput = document.getElementById("field-maiden-name");
const suffixInput = document.getElementById("field-suffix");
const birthdayInput = document.getElementById("field-birthday");
const dateOfDeathInput = document.getElementById("field-date-of-death");
const genderSelect = document.getElementById("field-gender");
const identityInput = document.getElementById("field-gender-identity");
const descriptionInput = document.getElementById("field-description");
const photosInput = document.getElementById("field-photos");
const existingPhotosEl = document.getElementById("existing-photos");
const stagedPhotosEl = document.getElementById("staged-photos");
const avatarInput = document.getElementById("field-avatar");
const existingAvatarEl = document.getElementById("existing-avatar");
const submittedByInput = document.getElementById("field-submitted-by");
const hiddenCheckbox = document.getElementById("field-hidden");
const isPetCheckbox = document.getElementById("field-is-pet");
const submitBtn = document.getElementById("edit-submit-btn");
const deleteBtn = document.getElementById("edit-delete-btn");

// --- module-level state for whichever form instance is currently open ---
let currentMode = "add"; // "add" | "update"
let currentPersonId = null;
let currentPersonData = null;
let currentPersonRels = null;
let originalSpouseIds = []; // spouses at form-open time, to diff against on submit
let peopleListRef = [];
let relationRows = []; // [{ type: 'spouse', personId: string }]

const photoFields = createPhotoFieldsController({
  idPrefix: "",
  existingPhotosEl,
  stagedPhotosEl,
  existingAvatarEl,
  avatarInput,
  photosInput,
});

/**
 * Opens the FULL edit/add panel (parents, spouse, delete — everything).
 * This is intentionally separate from the lightweight quick-edit in the
 * view side panel, which only covers basic fields.
 * @param {"add"|"update"} mode
 * @param {object|null} person - existing person ({id, data, rels}) when editing, null when adding
 * @param {Array} peopleList - full people array, used for the relation dropdowns
 * @param {Function} onSubmitted - called after a successful submission
 * @param {Function} onDeleted - called after a successful delete submission
 */
export function openEditForm({ mode, person = null, peopleList = [], onSubmitted, onDeleted }) {
  if (mode === "update" && !person) {
    console.error("[editForm] opened in update mode but person is null/undefined — check the caller's familyData.find() lookup");
  }
  currentMode = mode;
  currentPersonId = person?.id || null;
  currentPersonData = person?.data || {};
  currentPersonRels = person?.rels || { spouses: [], children: [], parents: [] };
  peopleListRef = peopleList;
  relationRows = [];

  titleEl.textContent = mode === "add" ? "Add Person" : `Edit ${formatFullName(currentPersonData) || "Person"}`;
  deleteBtn.classList.toggle("hidden", mode !== "update");

  if (mode === "add") {
    relationRows = [{ type: "spouse", personId: "" }];
    originalSpouseIds = [];
  } else {
    originalSpouseIds = [...(currentPersonRels.spouses || [])];
    relationRows = originalSpouseIds.map((id) => ({ type: "spouse", personId: id }));
  }
  renderRelationRows();
  populateParentDropdowns(peopleList, currentPersonId);

  const bio = currentPersonData.parents_bio || [];
  const adoptive = currentPersonData.parents_adoptive || [];
  bioParent1Sel.value = bio[0] || "";
  bioParent2Sel.value = bio[1] || "";
  adoptiveParent1Sel.value = adoptive[0] || "";
  adoptiveParent2Sel.value = adoptive[1] || "";

  firstNameInput.value = currentPersonData["first name"] || "";
  middleNameInput.value = currentPersonData["middle name"] || "";
  lastNameInput.value = currentPersonData["last name"] || "";
  maidenNameInput.value = currentPersonData.maiden_name || "";
  suffixInput.value = currentPersonData.suffix || "";
  birthdayInput.value = currentPersonData.birthday || "";
  dateOfDeathInput.value = currentPersonData.date_of_death || "";
  genderSelect.value = currentPersonData.gender || "M";
  identityInput.value = currentPersonData.gender_identity || "";
  descriptionInput.value = currentPersonData.description || "";
  submittedByInput.value = "";
  hiddenCheckbox.checked = !!currentPersonData.hidden;
  isPetCheckbox.checked = !!currentPersonData.is_pet;

  photoFields.reset(currentPersonData);

  document.getElementById("side-panel")?.classList.add("hidden");
  modal.classList.remove("hidden");
  window.dispatchEvent(new Event("family-tree:layout-changed"));

  form.onsubmit = async (e) => {
    e.preventDefault();
    await handleSubmit(onSubmitted);
  };

  deleteBtn.onclick = async () => {
    await handleDelete(onDeleted);
  };
}

function populateParentDropdowns(peopleList, excludeId) {
  const optionsHtml =
    `<option value="">— none —</option>` +
    peopleList
      .filter((p) => p.id !== excludeId)
      .sort((a, b) => formatFullName(a.data).localeCompare(formatFullName(b.data)))
      .map((p) => `<option value="${p.id}">${formatFullName(p.data) || p.id}</option>`)
      .join("");

  [bioParent1Sel, bioParent2Sel, adoptiveParent1Sel, adoptiveParent2Sel].forEach((sel) => {
    sel.innerHTML = optionsHtml;
  });
}

// When Parent 1 is chosen and Parent 2 is still empty, auto-fill Parent 2
// with one of Parent 1's existing spouses (if they have one in the data).
function autofillOtherParent(parent1Sel, parent2Sel) {
  parent1Sel.addEventListener("change", () => {
    if (parent2Sel.value) return;
    const chosen = peopleListRef.find((p) => p.id === parent1Sel.value);
    const spouseId = chosen?.rels?.spouses?.[0];
    if (spouseId && [...parent2Sel.options].some((o) => o.value === spouseId)) {
      parent2Sel.value = spouseId;
    }
  });
}
autofillOtherParent(bioParent1Sel, bioParent2Sel);
autofillOtherParent(adoptiveParent1Sel, adoptiveParent2Sel);

// ---------------------------------------------------------------------------
// Relations list (spouse links)
// ---------------------------------------------------------------------------
function renderRelationRows() {
  if (!relationRows.length) {
    relationsListEl.innerHTML = `<p class="no-relations-note">No spouse recorded.</p>`;
    return;
  }

  relationsListEl.innerHTML = relationRows
    .map((row, i) => {
      const peopleOptions = [...peopleListRef]
        .sort((a, b) => formatFullName(a.data).localeCompare(formatFullName(b.data)))
        .map((p) => {
          const selected = p.id === row.personId ? "selected" : "";
          return `<option value="${p.id}" ${selected}>${formatFullName(p.data) || p.id}</option>`;
        })
        .join("");

      return `
        <div class="relation-row" data-index="${i}">
          <span class="relation-row-label">Spouse of</span>
          <select class="relation-person-select" name="relation-person-${i}" data-index="${i}">
            <option value="">— choose a person —</option>
            ${peopleOptions}
          </select>
          <button type="button" class="remove-relation-btn" data-index="${i}">Remove</button>
        </div>
      `;
    })
    .join("");

  relationsListEl.querySelectorAll(".relation-person-select").forEach((sel) => {
    sel.addEventListener("change", () => {
      relationRows[Number(sel.dataset.index)].personId = sel.value;
    });
  });
  relationsListEl.querySelectorAll(".remove-relation-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      relationRows.splice(Number(btn.dataset.index), 1);
      renderRelationRows();
    });
  });
}

addRelationRowBtn.addEventListener("click", () => {
  relationRows.push({ type: "spouse", personId: "" });
  renderRelationRows();
});

function closeEditPanel() {
  modal.classList.add("hidden");
  window.dispatchEvent(new Event("family-tree:layout-changed"));
}

document.getElementById("edit-close").addEventListener("click", closeEditPanel);

function slugify(str) {
  return (
    str
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "") || "person"
  );
}

// ---------------------------------------------------------------------------
// Submit
// ---------------------------------------------------------------------------
async function handleSubmit(onSubmitted) {
  submitBtn.disabled = true;

  try {
    const personId =
      currentMode === "add"
        ? slugify(`${firstNameInput.value}-${lastNameInput.value}-${Date.now()}`)
        : currentPersonId;

    const { avatar, photos } = await photoFields.commit(personId, (msg) => {
      submitBtn.textContent = msg;
    });

    const parentsBio = [bioParent1Sel.value, bioParent2Sel.value].filter(Boolean);
    const parentsAdoptive = [adoptiveParent1Sel.value, adoptiveParent2Sel.value].filter(Boolean);

    const data = {
      ...currentPersonData,
      "first name": firstNameInput.value.trim(),
      "middle name": middleNameInput.value.trim(),
      "last name": lastNameInput.value.trim(),
      maiden_name: maidenNameInput.value.trim(),
      suffix: suffixInput.value.trim(),
      birthday: birthdayInput.value.trim(),
      date_of_death: dateOfDeathInput.value.trim(),
      gender: genderSelect.value,
      gender_identity: identityInput.value.trim(),
      description: descriptionInput.value.trim(),
      avatar,
      photos,
      parents_bio: parentsBio,
      parents_adoptive: parentsAdoptive,
      hidden: hiddenCheckbox.checked,
      is_pet: isPetCheckbox.checked,
    };

    const rels = currentMode === "add" ? { spouses: [], children: [], parents: [] } : currentPersonRels;

    const currentSpouseIds = relationRows.filter((r) => r.personId).map((r) => r.personId);
    const relations = currentSpouseIds
      .filter((id) => !originalSpouseIds.includes(id))
      .map((id) => ({ type: "spouse", person_id: id }));
    const relationsRemove = originalSpouseIds
      .filter((id) => !currentSpouseIds.includes(id))
      .map((id) => ({ type: "spouse", person_id: id }));

    submitBtn.textContent = "Submitting…";

    const { error } = await submitPendingEdit({
      editType: currentMode,
      personId,
      payload: { data, rels },
      relations,
      relationsRemove,
      submittedBy: submittedByInput.value.trim(),
    });

    if (error) {
      alert(`Submission failed: ${error.message}`);
      return;
    }

    await photoFields.cleanupDeletedPhotos();

    closeEditPanel();
    onSubmitted?.();
  } catch (err) {
    alert(`Something went wrong: ${err.message}`);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Submit";
  }
}

async function handleDelete(onDeleted) {
  if (!currentPersonId) {
    alert("No person is selected (this shouldn't happen — please close and reopen the edit form, and let the developer know).");
    console.error("[editForm] handleDelete called with currentPersonId =", currentPersonId, "currentPersonData =", currentPersonData);
    return;
  }

  const name = formatFullName(currentPersonData);
  if (!confirm(`Submit a request to delete ${name || "this person"}? An admin must approve it.`)) return;

  deleteBtn.disabled = true;
  try {
    const { error } = await submitPendingEdit({
      editType: "delete",
      personId: currentPersonId,
      payload: {},
      submittedBy: submittedByInput.value.trim(),
    });

    if (error) {
      alert(`Delete request failed: ${error.message}`);
      return;
    }

    closeEditPanel();
    onDeleted?.();
  } finally {
    deleteBtn.disabled = false;
  }
}
