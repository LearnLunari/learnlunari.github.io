/* English → Lunari Translator
   - Loads lunari_dict.json (built-in) unless a custom dictionary is stored in localStorage
   - Supports phrase matches + word matches
   - Preserves punctuation and basic casing
*/

const els = {
  englishInput: document.getElementById("englishInput"),
  lunariOutput: document.getElementById("lunariOutput"),
  btnTranslate: document.getElementById("btnTranslate"),
  btnClear: document.getElementById("btnClear"),
  btnCopy: document.getElementById("btnCopy"),
  dictStatus: document.getElementById("dictStatus"),
  preferPhrases: document.getElementById("preferPhrases"),
  markUnknown: document.getElementById("markUnknown"),
  dictFile: document.getElementById("dictFile"),
  btnUseBuiltIn: document.getElementById("btnUseBuiltIn"),
  btnExportDict: document.getElementById("btnExportDict"),
  quickAdd: document.getElementById("quickAdd"),
  btnAddLines: document.getElementById("btnAddLines"),
};

const LS_KEY = "lunari_custom_dict_v1";
let activeDict = null;
let builtInDict = null;

function normalizeSpaces(s) {
  return s.trim().replace(/\s+/g, " ");
}

function isAllCaps(s) {
  return s.length > 1 && s === s.toUpperCase();
}

function isTitleCase(s) {
  return s.length > 0 && s[0] === s[0].toUpperCase() && s.slice(1) === s.slice(1).toLowerCase();
}

function applyCasing(sourceToken, translatedToken) {
  if (!translatedToken) return translatedToken;
  if (isAllCaps(sourceToken)) return translatedToken.toUpperCase();
  if (isTitleCase(sourceToken)) return translatedToken[0].toUpperCase() + translatedToken.slice(1).toLowerCase();
  // default: lower (but keep as-is if user typed weird case)
  if (sourceToken === sourceToken.toLowerCase()) return translatedToken.toLowerCase();
  return translatedToken;
}

function tokenizeKeepPunct(input) {
  // Splits into tokens where words and non-words are separate.
  // Words include letters and apostrophes (e.g., don't). Everything else is kept.
  // Example: "Hello, world!" => ["Hello", ", ", "world", "!"]
  return input.match(/[A-Za-z]+(?:'[A-Za-z]+)?|[^A-Za-z]+/g) || [];
}

function lookupWord(englishWord) {
  const key = englishWord.toLowerCase();
  const entry = activeDict?.words?.[key];
  if (!entry) return null;
  // allow either {l:"..."} or direct string
  if (typeof entry === "string") return entry;
  if (typeof entry === "object" && entry.l) return entry.l;
  return null;
}

function lookupPhrase(englishText) {
  const key = normalizeSpaces(englishText).toLowerCase();
  const phrase = activeDict?.phrases?.[key];
  if (!phrase) return null;
  return phrase;
}

function translateText(englishText) {
  if (!activeDict) return englishText;

  const preferPhrases = els.preferPhrases.checked;

  // 1) phrase match (exact)
  if (preferPhrases) {
    const phraseHit = lookupPhrase(englishText);
    if (phraseHit) return phraseHit;
  }

  // 2) word-by-word
  const tokens = tokenizeKeepPunct(englishText);
  const out = tokens.map(tok => {
    // Only translate pure word tokens
    if (/^[A-Za-z]+(?:'[A-Za-z]+)?$/.test(tok)) {
      const base = tok.toLowerCase();
      // optional: strip trailing "'s" (basic possessive)
      let possessive = false;
      let baseWord = base;
      if (base.endsWith("'s") && base.length > 2) {
        possessive = true;
        baseWord = base.slice(0, -2);
      }

      const found = lookupWord(baseWord);
      if (!found) {
        return els.markUnknown.checked ? `[${tok}]` : tok;
      }
      let translated = applyCasing(tok, found);

      // If possessive in English, you can decide how you want it handled.
      // Lunari in the guide uses "-de" for "of". We'll do: "X's" => "X-de".
      if (possessive) translated = `${translated}-de`;

      return translated;
    }
    return tok; // punctuation / whitespace
  });

  const joined = out.join("");

  // 3) If phrases are not preferred, still allow “whole input” fallback phrase
  if (!preferPhrases) {
    const phraseHit = lookupPhrase(englishText);
    if (phraseHit) return phraseHit;
  }

  return joined;
}

function setStatus(text, kind = "ok") {
  els.dictStatus.textContent = text;
  els.dictStatus.style.borderColor =
    kind === "ok" ? "rgba(91,182,255,.45)" :
    kind === "warn" ? "rgba(255,214,102,.55)" :
    "rgba(255,107,107,.55)";
}

async function loadBuiltInDict() {
  const res = await fetch("./lunari_dict.json", { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load lunari_dict.json (${res.status})`);
  return await res.json();
}

function loadCustomDictFromLS() {
  const raw = localStorage.getItem(LS_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveCustomDictToLS(dict) {
  localStorage.setItem(LS_KEY, JSON.stringify(dict));
}

function clearCustomDictFromLS() {
  localStorage.removeItem(LS_KEY);
}

function ensureDictShape(dict) {
  if (!dict || typeof dict !== "object") return { meta: {}, words: {}, phrases: {} };
  dict.meta = dict.meta && typeof dict.meta === "object" ? dict.meta : {};
  dict.words = dict.words && typeof dict.words === "object" ? dict.words : {};
  dict.phrases = dict.phrases && typeof dict.phrases === "object" ? dict.phrases : {};
  return dict;
}

function setActiveDict(dict, sourceLabel) {
  activeDict = ensureDictShape(dict);
  const wordCount = Object.keys(activeDict.words).length;
  const phraseCount = Object.keys(activeDict.phrases).length;
  setStatus(`${sourceLabel} • ${wordCount} words • ${phraseCount} phrases`, "ok");
}

function downloadText(filename, text) {
  const blob = new Blob([text], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function parseQuickAddLines(raw) {
  // Accept lines like:
  // hello = ya
  // good morning = yara muna
  const lines = raw.split("\n").map(l => l.trim()).filter(Boolean);
  const adds = { words: {}, phrases: {} };
  for (const line of lines) {
    const m = line.match(/^(.+?)\s*=\s*(.+)$/);
    if (!m) continue;
    const left = normalizeSpaces(m[1]).toLowerCase();
    const right = normalizeSpaces(m[2]);

    if (!left || !right) continue;
    if (left.includes(" ")) adds.phrases[left] = right;
    else adds.words[left] = right;
  }
  return adds;
}

function mergeAddsIntoDict(adds) {
  const dict = ensureDictShape(activeDict);
  for (const [k, v] of Object.entries(adds.words)) dict.words[k] = v;
  for (const [k, v] of Object.entries(adds.phrases)) dict.phrases[k] = v;
  // Persist as custom if it isn’t built-in
  saveCustomDictToLS(dict);
  setActiveDict(dict, "Custom dictionary (saved)");
}

async function init() {
  try {
    builtInDict = await loadBuiltInDict();
  } catch (e) {
    setStatus(`Could not load built-in dictionary: ${e.message}`, "err");
    builtInDict = { meta: {}, words: {}, phrases: {} };
  }

  const custom = loadCustomDictFromLS();
  if (custom) {
    setActiveDict(custom, "Custom dictionary (saved)");
  } else {
    setActiveDict(builtInDict, "Built-in dictionary");
  }

  // Translate on click
  els.btnTranslate.addEventListener("click", () => {
    const input = els.englishInput.value;
    els.lunariOutput.value = translateText(input);
  });

  // Translate on typing (nice UX)
  els.englishInput.addEventListener("input", () => {
    els.lunariOutput.value = translateText(els.englishInput.value);
  });

  els.btnClear.addEventListener("click", () => {
    els.englishInput.value = "";
    els.lunariOutput.value = "";
    els.englishInput.focus();
  });

  els.btnCopy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(els.lunariOutput.value || "");
      setStatus("Copied Lunari to clipboard", "ok");
      setTimeout(() => {
        const custom2 = loadCustomDictFromLS();
        setActiveDict(custom2 || builtInDict, custom2 ? "Custom dictionary (saved)" : "Built-in dictionary");
      }, 900);
    } catch {
      setStatus("Clipboard copy failed (browser blocked it)", "warn");
    }
  });

  // Upload custom dict JSON
  els.dictFile.addEventListener("change", async (ev) => {
    const file = ev.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = ensureDictShape(JSON.parse(text));
      saveCustomDictToLS(parsed);
      setActiveDict(parsed, "Custom dictionary (saved)");
      els.lunariOutput.value = translateText(els.englishInput.value);
    } catch (e) {
      setStatus(`Invalid JSON: ${e.message}`, "err");
    } finally {
      els.dictFile.value = "";
    }
  });

  // Revert to built-in
  els.btnUseBuiltIn.addEventListener("click", () => {
    clearCustomDictFromLS();
    setActiveDict(builtInDict, "Built-in dictionary");
    els.lunariOutput.value = translateText(els.englishInput.value);
  });

  // Export current dict
  els.btnExportDict.addEventListener("click", () => {
    const dict = ensureDictShape(activeDict);
    const filename = "lunari_dict_export.json";
    downloadText(filename, JSON.stringify(dict, null, 2));
  });

  // Quick add lines
  els.btnAddLines.addEventListener("click", () => {
    const adds = parseQuickAddLines(els.quickAdd.value);
    const count = Object.keys(adds.words).length + Object.keys(adds.phrases).length;
    if (count === 0) {
      setStatus("No valid lines found to add", "warn");
      return;
    }
    mergeAddsIntoDict(adds);
    els.quickAdd.value = "";
    els.lunariOutput.value = translateText(els.englishInput.value);
    setStatus(`Added ${count} entries to custom dictionary (saved)`, "ok");
  });

  // Initial translate
  els.lunariOutput.value = translateText(els.englishInput.value);
}

init();
