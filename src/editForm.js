import { uploadPhotos } from "./photoUpload.js";
import { submitPendingEdit } from "./editSession.js";

const modal = document.getElementById("edit-modal");
const form = document.getElementById("edit-form");
const titleEl = document.getElementById("edit-modal-title");
const relationFields = document.getElementById("relation-fields");
const relationTypeSel = document.getElementById("field-relation-type");
const relationToSel = document.getElementById("field-relation-to");
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

// --- module-level state for whichever form instance is currently open ---
let currentMode = "add"; // "add" | "update"
let currentPersonId = null;
let currentPersonRels = null; // preserved as-is; this form doesn't edit relationships
let existingPhotos = [];
let stagedFiles = []; // [{ file, caption }]
let existingAvatarUrl = null;
let stagedAvatarFile = null; // File | null — replaces existingAvatarUrl on submit if set

/**
 * Opens the modal.
 * @param {"add"|"update"} mode
 * @param {object|null} person - existing person ({id, data, rels}) when editing, null when adding
 * @param {Array} peopleList - full people array, used to populate the "relation to" dropdown when adding
 * @param {Function} onSubmitted - called after a successful submission
 */
export function openEditForm({ mode, person = null, peopleList = [], onSubmitted }) {
  currentMode = mode;
  currentPersonId = person?.id || null;
  currentPersonRels = person?.rels || { spouses: [], children: [], parents: [] };
  existingPhotos = person?.data?.photos ? [...person.data.photos] : [];
  stagedFiles = [];
  existingAvatarUrl = person?.data?.avatar || null;
  stagedAvatarFile = null;

  titleEl.textContent = mode === "add" ? "Add Person" : `Edit ${person?.data?.["first name"] || "Person"}`;
  relationFields.classList.toggle("hidden", mode !== "add");

  if (mode === "add") {
    const noRelationOption = `<option value="">— No relation (standalone / first person) —</option>`;
    const peopleOptions = peopleList
      .map((p) => {
        const label = `${p.data["first name"] || ""} ${p.data["last name"] || ""}`.trim() || p.id;
        return `<option value="${p.id}">${label}</option>`;
      })
      .join("");
    relationToSel.innerHTML = noRelationOption + peopleOptions;
  }

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
}

function renderExistingPhotos() {
  existingPhotosEl.innerHTML = existingPhotos
    .map(
      (photo, i) => `
        <div class="existing-photo">
          <img src="${photo.url}" alt="${photo.caption || ""}" />
          <button type="button" class="remove-photo-btn" data-index="${i}">Remove</button>
        </div>
      `
    )
    .join("");

  existingPhotosEl.querySelectorAll(".remove-photo-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      existingPhotos.splice(Number(btn.dataset.index), 1);
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
      existingAvatarUrl = null;
      renderExistingAvatar();
    });
    return;
  }

  existingAvatarEl.innerHTML = "";
}

avatarInput.addEventListener("change", () => {
  if (avatarInput.files[0]) {
    stagedAvatarFile = avatarInput.files[0];
    avatarInput.value = "";
    renderExistingAvatar();
  }
});

photosInput.addEventListener("change", () => {
  const newFiles = Array.from(photosInput.files).map((file) => ({ file, caption: "" }));
  stagedFiles.push(...newFiles);
  photosInput.value = ""; // allow re-selecting the same file again later if needed
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

    const data = {
      "first name": firstNameInput.value.trim(),
      "last name": lastNameInput.value.trim(),
      birthday: birthdayInput.value.trim(),
      gender: genderSelect.value,
      gender_identity: identityInput.value.trim(),
      description: descriptionInput.value.trim(),
      avatar: avatarUrl || "",
      photos: [...existingPhotos, ...newlyUploaded],
    };

    // Adding a brand-new person starts with empty relationship arrays — the
    // reciprocal link (e.g. adding them as a child of someone) is applied
    // automatically when the admin approves, based on relation_to/relation_type.
    // Editing an existing person keeps their current rels untouched, since
    // this form doesn't offer relationship editing yet.
    const rels = currentMode === "add" ? { spouses: [], children: [], parents: [] } : currentPersonRels;

    submitBtn.textContent = "Submitting…";

    const { error } = await submitPendingEdit({
      editType: currentMode,
      personId,
      payload: { data, rels },
      relationToId: currentMode === "add" ? relationToSel.value : null,
      relationType: currentMode === "add" ? relationTypeSel.value : null,
      submittedBy: submittedByInput.value.trim(),
    });

    if (error) {
      alert(`Submission failed: ${error.message}`);
      return;
    }

    modal.classList.add("hidden");
    onSubmitted?.();
  } catch (err) {
    alert(`Something went wrong: ${err.message}`);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Submit for approval";
  }
}
