const I18N = {
  en: {
    eyebrow: "PaddleOCR + GPT pipeline",
    title1: "Read any document,",
    title2: "get what matters.",
    lead: "Upload an invoice, receipt or bank notice. We extract the text with PaddleOCR, then GPT finds the sender and the amount for you.",
    stepUpload: "Upload",
    uploadTitle: "Your document",
    dropTitle: "Drop your file here",
    dropHint: "or click to browse · PNG, JPG or PDF",
    run: "Extract sender & amount",
    running: "Analyzing…",
    waitHint: "Images take a few seconds. PDFs are read page by page and can take a couple of minutes.",
    resultTitle: "Result",
    done: "Done",
    emptyText: "Upload a document and run the pipeline to see the sender and amount here.",
    sender: "Sender",
    amount: "Amount",
    notFound: "Not found",
    copy: "Copy",
    copied: "Copied to clipboard",
    remove: "Remove file",
    theme: "Toggle theme",
    errNoFile: "Please choose an image or PDF first.",
    errType: "Only images (PNG, JPG…) and PDF files are supported.",
    errNetwork: "Could not reach the server. Is it running?",
    howTitle: "How it works",
    how1Title: "Upload",
    how1Text: "Drop an image or a multi-page PDF. Nothing is stored: the file is deleted right after processing.",
    how2Title: "Extract with PaddleOCR",
    how2Text: "PaddleOCR detects and reads every line of text in your document.",
    how3Title: "Understand with GPT",
    how3Text: "GPT fixes OCR mistakes and returns only the sender and the total amount.",
    footer: "OCR + GPT · v1",
  },
  fr: {
    eyebrow: "Pipeline PaddleOCR + GPT",
    title1: "Lisez n'importe quel document,",
    title2: "gardez l'essentiel.",
    lead: "Importez une facture, un reçu ou un avis bancaire. PaddleOCR extrait le texte, puis GPT trouve l'expéditeur et le montant pour vous.",
    stepUpload: "Import",
    uploadTitle: "Votre document",
    dropTitle: "Déposez votre fichier ici",
    dropHint: "ou cliquez pour parcourir · PNG, JPG ou PDF",
    run: "Extraire expéditeur et montant",
    running: "Analyse en cours…",
    waitHint: "Une image prend quelques secondes. Un PDF est lu page par page et peut prendre quelques minutes.",
    resultTitle: "Résultat",
    done: "Terminé",
    emptyText: "Importez un document et lancez le pipeline pour voir ici l'expéditeur et le montant.",
    sender: "Expéditeur",
    amount: "Montant",
    notFound: "Introuvable",
    copy: "Copier",
    copied: "Copié dans le presse-papiers",
    remove: "Retirer le fichier",
    theme: "Changer de thème",
    errNoFile: "Veuillez d'abord choisir une image ou un PDF.",
    errType: "Seules les images (PNG, JPG…) et les fichiers PDF sont acceptés.",
    errNetwork: "Impossible de joindre le serveur. Est-il démarré ?",
    howTitle: "Comment ça marche",
    how1Title: "Importer",
    how1Text: "Déposez une image ou un PDF de plusieurs pages. Rien n'est conservé : le fichier est supprimé juste après le traitement.",
    how2Title: "Extraire avec PaddleOCR",
    how2Text: "PaddleOCR détecte et lit chaque ligne de texte de votre document.",
    how3Title: "Comprendre avec GPT",
    how3Text: "GPT corrige les erreurs d'OCR et renvoie uniquement l'expéditeur et le montant total.",
    footer: "OCR + GPT · v1",
  },
};

const $ = (id) => document.getElementById(id);
const store = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch { /* storage unavailable */ } },
};

let lang = store.get("lang") || (navigator.language.startsWith("fr") ? "fr" : "en");
const t = (key) => I18N[lang][key] ?? key;

function applyLang() {
  document.documentElement.lang = lang;
  document.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll("[data-i18n-aria]").forEach((el) => {
    el.setAttribute("aria-label", t(el.dataset.i18nAria));
    el.title = t(el.dataset.i18nAria);
  });
  document.querySelectorAll(".lang-btn").forEach((b) => b.classList.toggle("active", b.dataset.lang === lang));
  if ($("submit").classList.contains("loading")) updateRunningLabel();
  document.querySelectorAll(".field-value.missing").forEach((el) => { el.textContent = t("notFound"); });
}

document.querySelectorAll(".lang-btn").forEach((b) => b.addEventListener("click", () => {
  lang = b.dataset.lang;
  store.set("lang", lang);
  applyLang();
}));

/* ---------- Theme ---------- */
function currentTheme() {
  return document.documentElement.dataset.theme
    || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
}
document.documentElement.dataset.theme = store.get("theme") || currentTheme();
$("theme-toggle").addEventListener("click", () => {
  const next = currentTheme() === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  store.set("theme", next);
});

/* ---------- Pipeline steps ---------- */
function setSteps(state) {
  const steps = { upload: "", ocr: "", llm: "" };
  if (state === "ready") steps.upload = "done";
  if (state === "running") Object.assign(steps, { upload: "done", ocr: "active", llm: "active" });
  if (state === "done") Object.assign(steps, { upload: "done", ocr: "done", llm: "done" });
  document.querySelectorAll(".step").forEach((el) => {
    el.classList.remove("active", "done");
    if (steps[el.dataset.step]) el.classList.add(steps[el.dataset.step]);
  });
}

/* ---------- File selection ---------- */
const fileInput = $("file");
const dropzone = $("dropzone");
let selectedFile = null;

function formatSize(bytes) {
  const units = ["B", "KB", "MB"];
  let i = 0;
  while (bytes >= 1024 && i < units.length - 1) { bytes /= 1024; i++; }
  return `${bytes.toLocaleString(lang, { maximumFractionDigits: 1 })} ${units[i]}`;
}

function showError(message) {
  const el = $("field-error");
  el.textContent = message;
  el.classList.add("show");
  dropzone.classList.remove("invalid");
  void dropzone.offsetWidth; // restart the shake animation
  dropzone.classList.add("invalid");
}

function clearError() {
  $("field-error").classList.remove("show");
  dropzone.classList.remove("invalid");
}

function setFile(file) {
  clearError();
  if (file && !(file.type.startsWith("image/") || file.type === "application/pdf")) {
    showError(t("errType"));
    file = null;
  }
  selectedFile = file;
  $("dz-empty").hidden = !!file;
  $("dz-file").hidden = !file;
  const thumb = $("thumb");
  thumb.innerHTML = "";
  if (!file) { setSteps("idle"); fileInput.value = ""; return; }

  $("file-name").textContent = file.name;
  $("file-size").textContent = formatSize(file.size);
  if (file.type.startsWith("image/")) {
    const img = document.createElement("img");
    img.alt = "";
    img.src = URL.createObjectURL(file);
    img.onload = () => URL.revokeObjectURL(img.src);
    thumb.appendChild(img);
  } else {
    thumb.textContent = "PDF";
  }
  setSteps("ready");
}

fileInput.addEventListener("change", () => setFile(fileInput.files[0] || null));
$("remove").addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); setFile(null); });

["dragenter", "dragover"].forEach((ev) => dropzone.addEventListener(ev, (e) => {
  e.preventDefault();
  dropzone.classList.add("dragging");
}));
["dragleave", "drop"].forEach((ev) => dropzone.addEventListener(ev, (e) => {
  e.preventDefault();
  dropzone.classList.remove("dragging");
}));
dropzone.addEventListener("drop", (e) => setFile(e.dataTransfer.files[0] || null));

/* ---------- Results ---------- */
function showResultState(state) {
  $("empty").hidden = state !== "empty";
  $("skeleton").hidden = state !== "loading";
  $("fields").hidden = state !== "result";
  $("badge").hidden = state !== "result";
}

function renderValue(id, value) {
  const el = $(id);
  el.classList.toggle("missing", value == null || value === "");
  el.textContent = el.classList.contains("missing") ? t("notFound") : value;
}

function replayAnimations(container) {
  // Reset the animation so the entrance plays again on each new result.
  container.querySelectorAll(".field, .check-path").forEach((el) => {
    el.style.animation = "none";
    void el.offsetWidth;
    el.style.animation = "";
  });
}

let toastTimer;
function toast(message) {
  const el = $("toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 1800);
}

document.querySelectorAll("[data-copy]").forEach((btn) => btn.addEventListener("click", async () => {
  const el = $(btn.dataset.copy);
  if (el.classList.contains("missing")) return;
  try {
    await navigator.clipboard.writeText(el.textContent);
    toast(t("copied"));
  } catch { /* clipboard blocked */ }
}));

/* ---------- Submit ---------- */
let startedAt = 0;
let elapsedTimer;

function updateRunningLabel() {
  const seconds = Math.floor((Date.now() - startedAt) / 1000);
  $("submit").querySelector(".btn-label").textContent = `${t("running")} ${seconds}s`;
}

function setLoading(on) {
  const btn = $("submit");
  btn.disabled = on;
  btn.classList.toggle("loading", on);
  $("wait-hint").hidden = !on;
  clearInterval(elapsedTimer);
  if (on) {
    startedAt = Date.now();
    updateRunningLabel();
    elapsedTimer = setInterval(updateRunningLabel, 1000);
  } else {
    btn.querySelector(".btn-label").textContent = t("run");
  }
}

$("form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!selectedFile) { showError(t("errNoFile")); return; }
  clearError();
  setLoading(true);
  setSteps("running");
  showResultState("loading");

  const body = new FormData();
  body.append("image", selectedFile);
  try {
    const res = await fetch("/process", { method: "POST", body });
    const data = await res.json().catch(() => ({ error: `Server error (${res.status})` }));
    if (data.error) throw new Error(data.error);
    renderValue("sender", data.sender);
    renderValue("amount", data.amount);
    showResultState("result");
    replayAnimations($("fields").parentElement);
    setSteps("done");
  } catch (err) {
    showResultState("empty");
    setSteps("ready");
    showError(err instanceof TypeError ? t("errNetwork") : err.message);
  } finally {
    setLoading(false);
  }
});

/* ---------- Scroll reveal ---------- */
const observer = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (entry.isIntersecting) {
      entry.target.classList.add("in");
      observer.unobserve(entry.target);
    }
  });
}, { rootMargin: "0px 0px -80px 0px" });
document.querySelectorAll(".reveal-scroll").forEach((el) => observer.observe(el));

applyLang();
showResultState("empty");
