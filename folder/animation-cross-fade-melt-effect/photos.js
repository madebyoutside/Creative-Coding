// The photos in the loop: the default ones imported in sketch.js, plus any
// added in the panel. Added photos are kept in this browser (IndexedDB), so
// they are still there after a reload. They are never uploaded anywhere.

const MAX_PHOTO_WIDTH = 2560;
const DB_NAME = 'animation-cross-fade-melt-effect';
const STORE = 'photos';
const KEY = 'library';

export function createLibrary(defaultUrls, onChange) {
  const defaults = defaultUrls.map((url, i) => ({ url, name: `photo-${i + 1}`, isDefault: true, image: null }));
  let added = [];
  let useDefaults = true;
  let restored = false;   // photos saved on an earlier visit are back
  let photos = [];

  function rebuild() {
    const wanted = [...(useDefaults ? defaults : []), ...added];
    const loop = wanted.filter((photo) => photo.image);
    const loading = wanted.some((photo) => !photo.image);
    // wait for saved photos instead of flashing the defaults; never stay empty
    if (!restored) photos = [];
    else if (loop.length || loading) photos = loop;
    else photos = defaults.filter((photo) => photo.image);
    onChange();
  }

  function load(photo) {
    loadImage(photo.url, (image) => {
      if (image.width > MAX_PHOTO_WIDTH) image.resize(MAX_PHOTO_WIDTH, 0);
      photo.image = image;
      rebuild();
    }, () => {
      // not a readable image: drop it
      added = added.filter((p) => p !== photo);
      save();
      rebuild();
    });
  }

  function addFiles(files) {
    files
      .filter((file) => file.type.startsWith('image/'))
      .forEach((file) => {
        const photo = { blob: file, name: file.name, url: URL.createObjectURL(file), isDefault: false, image: null };
        added.push(photo);
        load(photo);
      });
    save();
    rebuild();
  }

  function clearAdded() {
    added.forEach((photo) => URL.revokeObjectURL(photo.url));
    added = [];
  }

  function save() {
    writeDb({ useDefaults, files: added.map(({ blob, name }) => ({ blob, name })) });
  }

  defaults.forEach(load);

  // bring back photos added on an earlier visit
  readDb().then((saved) => {
    restored = true;
    if (saved) {
      useDefaults = saved.useDefaults;
      added = saved.files.map(({ blob, name }) => ({ blob, name, url: URL.createObjectURL(blob), isDefault: false, image: null }));
      added.forEach(load);
    }
    rebuild();
  });

  return {
    get photos() {
      return photos;
    },
    get useDefaults() {
      return useDefaults;
    },
    set useDefaults(value) {
      useDefaults = value;
      save();
      rebuild();
    },
    add: addFiles,
    // use only these photos: the defaults and anything added before are dropped
    replace(files) {
      clearAdded();
      useDefaults = false;
      addFiles(files);
    },
    remove(photo) {
      if (photo.isDefault) return;
      URL.revokeObjectURL(photo.url);
      added = added.filter((p) => p !== photo);
      save();
      rebuild();
    },
    reset() {
      clearAdded();
      useDefaults = true;
      save();
      rebuild();
    },
  };
}

// IndexedDB: one record holding the added photos. Fails quietly when storage is blocked.
function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readDb() {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const request = db.transaction(STORE).objectStore(STORE).get(KEY);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } catch {
    return null;
  }
}

async function writeDb(value) {
  try {
    const db = await openDb();
    db.transaction(STORE, 'readwrite').objectStore(STORE).put(value, KEY);
  } catch {
    // storage blocked: added photos last until the page is closed
  }
}
