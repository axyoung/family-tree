import { uploadPhotos, deletePhotos } from "./photoUpload.js";
import { submitPendingEdit } from "./editSession.js";

const panelView = document.getElementById("panel-view");
const panelQuickEdit = document.getElementById("panel-quick-edit");
const form = document.getElementById("quick-edit-form");
const firstNameInput = document.getElementById("qe-first-name");
const middleNameInput = document.getElementById("qe-middle-name");
const lastNameInput = document.getElementById("qe-last-name");
const maidenNameInput = document.getElementById("qe-maiden-name");
const suffixInput = document.getElementById("qe-suffix");
const birthdayInput = document.getElementById("qe-birthday");
const dateOfDeathInput = document.getElementById("qe-date-of-death");
const identityInput = document.getElementById("qe-gender-identity");
const descriptionInput = document.getElementById("qe-description");
const avatarInput = document.getElementById("qe-avatar");
const existingAvatarEl = document.getElementById("qe-existing-avatar");
const photosInput = document.getElementById("qe-photos");
const existingPhotosEl = document.getElementById("qe-existing-photos");
const stagedPhotosEl = document.getElementById("qe-staged-photos");
const submittedByInput = document.getElementById("qe-submitted-by");
const submitBtn = document.getElementById("qe-submit-btn");

let currentPersonId = null;
let currentPersonData = null;
let currentPersonRels = null; // preserved untouched — quick edit never changes relationships
let existingPhotos = [];
let stagedFiles = [];
let existingAvatarUrl = null;
let stagedAvatarFile = null;
let photosToDeleteFromStorage = [];
let isActive = false;

export function isQuickEditActive() {
  return isActive;
}

// Discards any in-progress quick-edit changes and returns the panel to view
// mode. Used when the panel is closed without hitting Submit.
export function cancelQuickEdit() {
  if (!isActive) return;
  backToView();
}

export function openQuickEdit(person, onSaved) {
  currentPersonId = person.id;
  currentPersonData = person.data || {};
  currentPersonRels = person.rels || { spouses: [], children: [], parents: [] };
  existingPhotos = currentPersonData.photos ? [...currentPersonData.photos] : [];
  stagedFiles = [];
  existingAvatarUrl = currentPersonData.avatar || null;
  stagedAvatarFile = null;
  photosToDeleteFromStorage = [];

  firstNameInput.value = currentPersonData["first name"] || "";
  middleNameInput.value = currentPersonData["middle name"] || "";
  lastNameInput.value = currentPersonData["last name"] || "";
  maidenNameInput.value = currentPersonData.maiden_name || "";
  suffixInput.value = currentPersonData.suffix || "";
  birthdayInput.value = currentPersonData.birthday || "";
  dateOfDeathInput.value = currentPersonData.date_of_death || "";
  identityInput.value = currentPersonData.gender_identity || "";
  descriptionInput.value = currentPersonData.description || "";
  submittedByInput.value = "";

  renderExistingPhotos();
  renderStagedPhotos();
  renderExistingAvatar();

  panelView.classList.add("hidden");
  panelQuickEdit.classList.remove("hidden");
  isActive = true;

  form.onsubmit = async (e) => {
    e.preventDefault();
    await save(onSaved);
  };
}

function backToView() {
  panelQuickEdit.classList.add("hidden");
  panelView.classList.remove("hidden");
  isActive = false;
}

function renderExistingPhotos() {
  existingPhotosEl.innerHTML = existingPhotos
    .map(
      (photo, i) => `
        <div class="existing-photo">
          <img src="${photo.url}" alt="${photo.caption || ""}" />
          <input type="text" class="existing-caption-input" name="qe-existing-caption-${i}" placeholder="Caption" data-index="${i}" value="${photo.caption || ""}" />
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
          <input type="text" placeholder="Caption" name="qe-staged-caption-${i}" data-index="${i}" class="staged-caption-input" value="${item.caption}" />
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
        <button type="button" id="qe-remove-staged-avatar-btn">Undo</button>
      </div>
    `;
    document.getElementById("qe-remove-staged-avatar-btn").addEventListener("click", () => {
      stagedAvatarFile = null;
      renderExistingAvatar();
    });
    return;
  }

  if (existingAvatarUrl) {
    existingAvatarEl.innerHTML = `
      <div class="existing-photo">
        <img src="${existingAvatarUrl}" alt="" />
        <button type="button" id="qe-remove-avatar-btn">Remove</button>
      </div>
    `;
    document.getElementById("qe-remove-avatar-btn").addEventListener("click", () => {
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

async function save(onSaved) {
  submitBtn.disabled = true;
  try {
    let newlyUploaded = [];
    if (stagedFiles.length) {
      submitBtn.textContent = "Uploading photos…";
      newlyUploaded = await uploadPhotos(currentPersonId, stagedFiles);
    }

    let avatarUrl = existingAvatarUrl;
    if (stagedAvatarFile) {
      submitBtn.textContent = "Uploading avatar…";
      const [uploaded] = await uploadPhotos(currentPersonId, [{ file: stagedAvatarFile, caption: "" }]);
      avatarUrl = uploaded.url;
    }

    // Spread over the ORIGINAL data so parents_bio/parents_adoptive and
    // anything else this form doesn't touch are preserved untouched.
    const data = {
      ...currentPersonData,
      "first name": firstNameInput.value.trim(),
      "middle name": middleNameInput.value.trim(),
      "last name": lastNameInput.value.trim(),
      maiden_name: maidenNameInput.value.trim(),
      suffix: suffixInput.value.trim(),
      birthday: birthdayInput.value.trim(),
      date_of_death: dateOfDeathInput.value.trim(),
      gender_identity: identityInput.value.trim(),
      description: descriptionInput.value.trim(),
      avatar: avatarUrl || "",
      photos: [...existingPhotos, ...newlyUploaded],
    };

    submitBtn.textContent = "Submitting…";

    const { error } = await submitPendingEdit({
      editType: "update",
      personId: currentPersonId,
      payload: { data, rels: currentPersonRels }, // rels untouched by this form
      relations: [],
      relationsRemove: [],
      submittedBy: submittedByInput.value.trim(),
    });

    if (error) {
      alert(`Submission failed: ${error.message}`);
      return;
    }

    if (photosToDeleteFromStorage.length) {
      await deletePhotos(photosToDeleteFromStorage);
    }

    backToView();
    onSaved?.();
  } catch (err) {
    alert(`Something went wrong: ${err.message}`);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Submit";
  }
}
