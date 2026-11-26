// Private browsing and some e-readers block localStorage. Then the values stay in memory only.
const memory = {};

const getStore = () => {
  try {
    const store = window.localStorage;
    const probe = '__bujo_probe__';
    store.setItem(probe, probe);
    store.removeItem(probe);
    return store;
  } catch {
    return null;
  }
};

const store = getStore();

export const readJson = (key, fallback) => {
  try {
    const raw = store ? store.getItem(key) : memory[key];
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
};

export const writeJson = (key, value) => {
  const raw = JSON.stringify(value);
  try {
    if (store) {
      store.setItem(key, raw);
      return;
    }
  } catch {
    // Quota errors are not important for a cache. The value goes to memory.
  }
  memory[key] = raw;
};

export const removeKey = (key) => {
  try {
    if (store) {
      store.removeItem(key);
    }
  } catch {
    // Nothing to remove.
  }
  delete memory[key];
};
