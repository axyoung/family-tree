import { uploadPhotos, deletePhotos } from "./photoUpload.js";

/**
 * Manages the "existing photos / staged new photos / avatar" UI shared by
 * both the full edit form and the lightweight quick-edit panel. Previously
 * this ~100 lines of logic was duplicated verbatim (with only id-prefix
 * differences) across both files — a real risk, since a fix applied to one
 * copy wouldn't automatically reach the other.
 *
 * @param {object} opts
 * @param {string} opts.idPrefix - prefix for generated input `name` attributes, so
 *   ids stay unique when both forms exist in the DOM at once (e.g. "qe-").
 * @param {HTMLElement} opts.existingPhotosEl
 * @param {HTMLElement} opts.stagedPhotosEl
 * @param {HTMLElement} opts.existingAvatarEl
 * @param {HTMLInputElement} opts.avatarInput
 * @param {HTMLInputElement} opts.photosInput
 */
export function createPhotoFieldsController({
  idPrefix = "",
  existingPhotosEl,
  stagedPhotosEl,
  existingAvatarEl,
  avatarInput,
  photosInput,
}) {
  let existingPhotos = [];
  let stagedFiles = [];
  let existingAvatarUrl = null;
  let stagedAvatarFile = null;
  let photosToDeleteFromStorage = [];

  function reset(person) {
    existingPhotos = person?.photos ? [...person.photos] : [];
    stagedFiles = [];
    existingAvatarUrl = person?.avatar || null;
    stagedAvatarFile = null;
    photosToDeleteFromStorage = [];
    renderExistingPhotos();
    renderStagedPhotos();
    renderExistingAvatar();
  }

  function renderExistingPhotos() {
    existingPhotosEl.innerHTML = existingPhotos
      .map(
        (photo, i) => `
          <div class="existing-photo">
            <img src="${photo.url}" alt="${photo.caption || ""}" />
            <input type="text" class="existing-caption-input" name="${idPrefix}existing-caption-${i}" placeholder="Caption" data-index="${i}" value="${photo.caption || ""}" />
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
            <input type="text" placeholder="Caption" name="${idPrefix}staged-caption-${i}" data-index="${i}" class="staged-caption-input" value="${item.caption}" />
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
    const undoBtnId = `${idPrefix}remove-staged-avatar-btn`;
    const removeBtnId = `${idPrefix}remove-avatar-btn`;

    if (stagedAvatarFile) {
      const previewUrl = URL.createObjectURL(stagedAvatarFile);
      existingAvatarEl.innerHTML = `
        <div class="existing-photo">
          <img src="${previewUrl}" alt="" />
          <button type="button" id="${undoBtnId}">Undo</button>
        </div>
      `;
      document.getElementById(undoBtnId).addEventListener("click", () => {
        stagedAvatarFile = null;
        renderExistingAvatar();
      });
      return;
    }

    if (existingAvatarUrl) {
      existingAvatarEl.innerHTML = `
        <div class="existing-photo">
          <img src="${existingAvatarUrl}" alt="" />
          <button type="button" id="${removeBtnId}">Remove</button>
        </div>
      `;
      document.getElementById(removeBtnId).addEventListener("click", () => {
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

  // Uploads any staged photos/avatar and returns the final { avatar, photos }
  // to merge into the person's data, plus deletes any removed files from
  // storage. `personId` is needed for the storage path.
  async function commit(personId, onProgress) {
    let newlyUploaded = [];
    if (stagedFiles.length) {
      onProgress?.("Uploading photos…");
      newlyUploaded = await uploadPhotos(personId, stagedFiles);
    }

    let avatarUrl = existingAvatarUrl;
    if (stagedAvatarFile) {
      onProgress?.("Uploading avatar…");
      const [uploaded] = await uploadPhotos(personId, [{ file: stagedAvatarFile, caption: "" }]);
      avatarUrl = uploaded.url;
    }

    return {
      avatar: avatarUrl || "",
      photos: [...existingPhotos, ...newlyUploaded],
    };
  }

  // Call AFTER a successful save, so we never delete storage files for an
  // edit that failed to persist.
  async function cleanupDeletedPhotos() {
    if (photosToDeleteFromStorage.length) {
      await deletePhotos(photosToDeleteFromStorage);
    }
  }

  return { reset, commit, cleanupDeletedPhotos };
}
