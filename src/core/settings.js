// Settings and persistent save data via localStorage.

const SETTINGS_KEY = 'noclipped.settings.v1';
const SAVE_KEY = 'noclipped.save.v1';
const CODEX_KEY = 'noclipped.codex.v1';

export const QUALITY = {
  low: { renderScale: 0.5, viewChunks: 1, bloom: false },
  medium: { renderScale: 0.7, viewChunks: 1, bloom: true },
  high: { renderScale: 0.9, viewChunks: 2, bloom: true },
};

const DEFAULTS = {
  sensitivity: 1.0,
  volume: 0.8,
  fov: 70,
  quality: 'medium',
  filmEffects: true,
  headBob: true,
  invertY: false,
};

function readJSON(key) {
  try {
    const s = localStorage.getItem(key);
    return s ? JSON.parse(s) : null;
  } catch (e) {
    return null;
  }
}

function writeJSON(key, v) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch (e) {
    /* storage unavailable */
  }
}

export class Settings {
  constructor() {
    this.data = { ...DEFAULTS, ...(readJSON(SETTINGS_KEY) || {}) };
    if (!QUALITY[this.data.quality]) this.data.quality = 'medium';
    this.listeners = [];
  }
  get(k) {
    return this.data[k];
  }
  set(k, v) {
    this.data[k] = v;
    writeJSON(SETTINGS_KEY, this.data);
    for (const l of this.listeners) l(k, v);
  }
  onChange(fn) {
    this.listeners.push(fn);
  }
  get q() {
    return QUALITY[this.data.quality];
  }
}

/** The run checkpoint: level, inventory, player stats. */
export const SaveData = {
  load() {
    return readJSON(SAVE_KEY);
  },
  save(d) {
    writeJSON(SAVE_KEY, { ...d, savedAt: Date.now() });
  },
  clear() {
    try {
      localStorage.removeItem(SAVE_KEY);
    } catch (e) {
      /* ignore */
    }
  },
};

/** The codex persists across runs: levels seen, entities glimpsed, notes read, endings found. */
export class Codex {
  constructor() {
    const d = readJSON(CODEX_KEY) || {};
    this.levels = new Set(d.levels || []);
    this.entities = new Set(d.entities || []);
    this.notes = new Set(d.notes || []);
    this.endings = new Set(d.endings || []);
    this.onNew = null;
  }
  _add(set, id, kind) {
    if (set.has(id)) return false;
    set.add(id);
    this.persist();
    if (this.onNew) this.onNew(kind, id);
    return true;
  }
  addLevel(id) {
    return this._add(this.levels, id, 'level');
  }
  addEntity(id) {
    return this._add(this.entities, id, 'entity');
  }
  addNote(id) {
    return this._add(this.notes, id, 'note');
  }
  addEnding(id) {
    return this._add(this.endings, id, 'ending');
  }
  persist() {
    writeJSON(CODEX_KEY, {
      levels: [...this.levels],
      entities: [...this.entities],
      notes: [...this.notes],
      endings: [...this.endings],
    });
  }
}
