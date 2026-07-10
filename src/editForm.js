import { uploadPhotos, deletePhotos } from "./photoUpload.js";
import { submitPendingEdit } from "./editSession.js";

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
const lastNameInput = document.getElementById("field-last-name");
const birthdayInput = document.getElementById("field-birthday");
const genderSelect = document.getElementById("field-gender");
const identityInput = document.getElementById("field-gender-identity");
const descriptionInput = document.getElementById("field-description");
const photosInput = document.getElementById("field-photos");
const existingPhotosEl = document.getElementById("existing-photos");
const stagedPhotosEl = document.getElementById("staged-photos");
const avatarInput = document.getElementById("field-avatar");
const existingAvatarEl = document.getElementById("existing-avatar");
const submittedByInput = document.getElementById("field-submitted-by");
const submitBtn = document.getElementById("edit-submit-btn");
const deleteBtn = document.getElementById("edit-delete-btn");

// --- module-level state for whichever form instance is currently open ---
let currentMode = "add"; // "add" | "update"
let currentPersonId = null;
let currentPersonData = null;
let currentPersonRels = null;
let existingPhotos = [];
let stagedFiles = [];
let existingAvatarUrl = null;
let stagedAvatarFile = null;
let photosToDeleteFromStorage = []; // existing photo/avatar objects removed this session
let peopleListRef = [];
let relationRows = []; // [{ type: 'child'|'parent'|'spouse', personId: string }]

/**
 * Opens the modal.
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
  existingPhotos = person?.data?.photos ? [...person.data.photos] : [];
  stagedFiles = [];
  existingAvatarUrl = person?.data?.avatar || null;
  stagedAvatarFile = null;
  photosToDeleteFromStorage = [];
  peopleListRef = peopleList;
  relationRows = [];

  titleEl.textContent = mode === "add" ? "Add Person" : `Edit ${person?.data?.["first name"] || "Person"}`;
  relationSection.classList.toggle("hidden", mode !== "add");
  deleteBtn.classList.toggle("hidden", mode !== "update");

  if (mode === "add") {
    relationRows = [{ type: "spouse", personId: "" }];
  }
  renderRelationRows();
  populateParentDropdowns(peopleList, currentPersonId);

  const bio = currentPersonData.parents_bio || [];
  const adoptive = currentPersonData.parents_adoptive || [];
  bioParent1Sel.value = bio[0] || "";
  bioParent2Sel.value = bio[1] || "";
  adoptiveParent1Sel.value = adoptive[0] || "";
  adoptiveParent2Sel.value = adoptive[1] || "";

  firstNameInput.value = person?.data?.["first name"] || "";
  lastNameInput.value = person?.data?.["last name"] || "";
  birthdayInput.value = person?.data?.birthday || "";
  genderSelect.value = person?.data?.gender || "M";
  identityInput.value = person?.data?.gender_identity || "";
  descriptionInput.value = person?.data?.description || "";
  submittedByInput.value = "";

  renderExistingPhotos();
  renderStagedPhotos();
  renderExistingAvatar();

  modal.classList.remove("hidden");

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
      .map((p) => {
        const label = `${p.data["first name"] || ""} ${p.data["last name"] || ""}`.trim() || p.id;
        return `<option value="${p.id}">${label}</option>`;
      })
      .join("");

  [bioParent1Sel, bioParent2Sel, adoptiveParent1Sel, adoptiveParent2Sel].forEach((sel) => {
    sel.innerHTML = optionsHtml;
  });
}

// ---------------------------------------------------------------------------
// Relations list (multi-relationship support)
// ---------------------------------------------------------------------------
function renderRelationRows() {
  if (!relationRows.length) {
    relationsListEl.innerHTML = `<p class="no-relations-note">No relation — this will be a standalone / first person.</p>`;
    return;
  }

  relationsListEl.innerHTML = relationRows
    .map((row, i) => {
      const peopleOptions = peopleListRef
        .map((p) => {
          const label = `${p.data["first name"] || ""} ${p.data["last name"] || ""}`.trim() || p.id;
          const selected = p.id === row.personId ? "selected" : "";
          return `<option value="${p.id}" ${selected}>${label}</option>`;
        })
        .join("");

      return `
        <div class="relation-row" data-index="${i}">
          <span class="relation-row-label">Spouse of</span>
          <select class="relation-person-select" data-index="${i}">
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

// ---------------------------------------------------------------------------
// Photos / avatar (unchanged from before)
// ---------------------------------------------------------------------------
function renderExistingPhotos() {
  existingPhotosEl.innerHTML = existingPhotos
    .map(
      (photo, i) => `
        <div class="existing-photo">
          <img src="${photo.url}" alt="${photo.caption || ""}" />
          <input type="text" class="existing-caption-input" placeholder="Caption" data-index="${i}" value="${photo.caption || ""}" />
          <button type="button" class="remove-photo-btn" data-index="${i}">Remove</button>
        </div>
      `
    )
    .join("");

  existingPhotosEl.querySelectorAll(".existing-caption-input").forEach((input) => {
    input.addEventListener("input", () => {
      existingPhotos[Number(input.dataset.index)].caption = input.value;
    });
  });

  existingPhotosEl.querySelectorAll(".remove-photo-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const [removed] = existingPhotos.splice(Number(btn.dataset.index), 1);
      if (removed) photosToDeleteFromStorage.push(removed);
      renderExistingPhotos();
    });
  });
}

function renderStagedPhotos() {
  stagedPhotosEl.innerHTML = stagedFiles
    .map(
      (item, i) => `
        <div class="staged-photo">
          <span>${item.file.name}</span>
          <input type="text" placeholder="Caption" data-index="${i}" class="staged-caption-input" value="${item.caption}" />
          <button type="button" class="remove-staged-btn" data-index="${i}">Remove</button>
        </div>
      `
    )
    .join("");

  stagedPhotosEl.querySelectorAll(".staged-caption-input").forEach((input) => {
    input.addEventListener("input", () => {
      stagedFiles[Number(input.dataset.index)].caption = input.value;
    });
  });

  stagedPhotosEl.querySelectorAll(".remove-staged-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      stagedFiles.splice(Number(btn.dataset.index), 1);
      renderStagedPhotos();
    });
  });
}

function renderExistingAvatar() {
  if (stagedAvatarFile) {
    const previewUrl = URL.createObjectURL(stagedAvatarFile);
    existingAvatarEl.innerHTML = `
      <div class="existing-photo">
        <img src="${previewUrl}" alt="" />
        <button type="button" id="remove-staged-avatar-btn">Undo</button>
      </div>
    `;
    document.getElementById("remove-staged-avatar-btn").addEventListener("click", () => {
      stagedAvatarFile = null;
      renderExistingAvatar();
    });
    return;
  }

  if (existingAvatarUrl) {
    existingAvatarEl.innerHTML = `
      <div class="existing-photo">
        <img src="${existingAvatarUrl}" alt="" />
        <button type="button" id="remove-avatar-btn">Remove</button>
      </div>
    `;
    document.getElementById("remove-avatar-btn").addEventListener("click", () => {
      photosToDeleteFromStorage.push({ url: existingAvatarUrl });
      existingAvatarUrl = null;
      renderExistingAvatar();
    });
    return;
  }

  existingAvatarEl.innerHTML = "";
}

avatarInput.addEventListener("change", () => {
  if (avatarInput.files[0]) {
    if (existingAvatarUrl) photosToDeleteFromStorage.push({ url: existingAvatarUrl });
    stagedAvatarFile = avatarInput.files[0];
    existingAvatarUrl = null;
    avatarInput.value = "";
    renderExistingAvatar();
  }
});

photosInput.addEventListener("change", () => {
  const newFiles = Array.from(photosInput.files).map((file) => ({ file, caption: "" }));
  stagedFiles.push(...newFiles);
  photosInput.value = "";
  renderStagedPhotos();
});

document.getElementById("edit-close").addEventListener("click", () => {
  modal.classList.add("hidden");
});
modal.addEventListener("click", (e) => {
  if (e.target === modal) modal.classList.add("hidden");
});

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

    let newlyUploaded = [];
    if (stagedFiles.length) {
      submitBtn.textContent = "Uploading photos…";
      newlyUploaded = await uploadPhotos(personId, stagedFiles);
    }

    let avatarUrl = existingAvatarUrl;
    if (stagedAvatarFile) {
      submitBtn.textContent = "Uploading avatar…";
      const [uploaded] = await uploadPhotos(personId, [{ file: stagedAvatarFile, caption: "" }]);
      avatarUrl = uploaded.url;
    }

    const parentsBio = [bioParent1Sel.value, bioParent2Sel.value].filter(Boolean);
    const parentsAdoptive = [adoptiveParent1Sel.value, adoptiveParent2Sel.value].filter(Boolean);

    const data = {
      ...currentPersonData,
      "first name": firstNameInput.value.trim(),
      "last name": lastNameInput.value.trim(),
      birthday: birthdayInput.value.trim(),
      gender: genderSelect.value,
      gender_identity: identityInput.value.trim(),
      description: descriptionInput.value.trim(),
      avatar: avatarUrl || "",
      photos: [...existingPhotos, ...newlyUploaded],
      parents_bio: parentsBio,
      parents_adoptive: parentsAdoptive,
    };

    const rels = currentMode === "add" ? { spouses: [], children: [], parents: [] } : currentPersonRels;

    const relations =
      currentMode === "add" ? relationRows.filter((r) => r.personId).map((r) => ({ type: r.type, person_id: r.personId })) : null;

    submitBtn.textContent = "Submitting…";

    const { error } = await submitPendingEdit({
      editType: currentMode,
      personId,
      payload: { data, rels },
      relations,
      submittedBy: submittedByInput.value.trim(),
    });

    if (error) {
      alert(`Submission failed: ${error.message}`);
      return;
    }

    if (photosToDeleteFromStorage.length) {
      await deletePhotos(photosToDeleteFromStorage);
    }

    modal.classList.add("hidden");
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

  const name = `${currentPersonData?.["first name"] || ""} ${currentPersonData?.["last name"] || ""}`.trim();
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

    modal.classList.add("hidden");
    onDeleted?.();
  } finally {
    deleteBtn.disabled = false;
  }
}
