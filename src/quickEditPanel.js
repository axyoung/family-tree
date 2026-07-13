import { submitPendingEdit } from "./editSession.js";
import { createPhotoFieldsController } from "./photoFieldsController.js";

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
let isActive = false;

const photoFields = createPhotoFieldsController({
  idPrefix: "qe-",
  existingPhotosEl,
  stagedPhotosEl,
  existingAvatarEl,
  avatarInput,
  photosInput,
});

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

  photoFields.reset(currentPersonData);

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

async function save(onSaved) {
  submitBtn.disabled = true;
  try {
    const { avatar, photos } = await photoFields.commit(currentPersonId, (msg) => {
      submitBtn.textContent = msg;
    });

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
      avatar,
      photos,
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

    await photoFields.cleanupDeletedPhotos();

    backToView();
    onSaved?.();
  } catch (err) {
    alert(`Something went wrong: ${err.message}`);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Submit";
  }
}
