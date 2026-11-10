// Picks the data adapter: live (Supabase) when keys are set in /config.js, demo otherwise.
import config from "/config.js";
import { applySections, readSectionCache, writeSectionCache } from "./sections.js";

// Sections edited in Admin → Sections, from this browser's cache until settings load.
applySections(config, readSectionCache());

export const LIVE = Boolean(config.supabase && config.supabase.url && config.supabase.key);
export { config };

let adapter;
let initError = null;
try {
  if (LIVE) {
    const m = await import("./live.js");
    adapter = await m.createLiveAdapter(config);
  } else {
    const m = await import("./demo.js");
    adapter = await m.createDemoAdapter(config);
  }
} catch (err) {
  console.error("[Fershman] Data layer failed to start:", err);
  initError = err;
  const fail = async () => { throw new Error("The site can't reach its database right now. Check the Supabase URL and key in config.js."); };
  adapter = new Proxy({ mode: LIVE ? "live" : "demo", broken: true }, {
    get(target, prop) { return prop in target ? target[prop] : fail; },
  });
}

if (!initError) {
  // Keep sections in step with the saved setting whenever settings load or the list is saved.
  const sync = (list) => { applySections(config, list); writeSectionCache(list); };
  const getSettings = adapter.getSettings.bind(adapter);
  adapter.getSettings = async (...args) => { const s = await getSettings(...args); sync(s && s.sections); return s; };
  const saveSetting = adapter.saveSetting.bind(adapter);
  adapter.saveSetting = async (k, value) => { const r = await saveSetting(k, value); if (k === "sections") sync(value); return r; };
}

export const db = adapter;
export const dbError = initError;
