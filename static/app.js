(() => {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  const form = $("#form");
  const fileInput = $("#fileInput");
  const dropzone = $("#dropzone");
  const runBtn = $("#runBtn");
  const statusEl = $("#status");
  const resultCard = $("#resultCard");
  const receiptsEl = $("#receipts");
  const copyBtn = $("#copyBtn");
  const waitHint = $("#waitHint");

  /* ---------- Language ---------- */
  const I18N = {
    en: {
      brandSub: "OCR → GPT pipeline",
      title1: "Read any document",
      title2: "in seconds",
      lead: "Drop a receipt, invoice or bank notice as an image or PDF. PaddleOCR reads it and GPT extracts the sender, the amount and the date.",
      progress: "Pipeline progress",
      stepUpload: "Upload",
      inputTitle: "Input",
      dropTitle: "Drop a file here or",
      browse: "browse",
      dropHint: "PNG, JPG, WEBP or PDF",
      remove: "Remove file",
      run: "Extract details",
      running: "Processing…",
      reading: "Reading the document…",
      waitHint: "PDFs are read page by page and can take a minute or two.",
      resultTitle: "Document details",
      emptyText: "The sender, amount and date will appear here.",
      sender: "Sender",
      amount: "Amount",
      date: "Date",
      notFound: "Not found",
      page: "Page",
      documents: "documents",
      completed: "Completed in",
      failedSuffix: "page(s) failed",
      failedToast: "page(s) could not be read",
      success: "Details extracted",
      copy: "Copy results",
      copied: "Copied — paste it straight into Excel",
      theme: "Toggle theme",
      errType: "Please choose an image or a PDF file.",
      errNetwork: "Could not reach the server. Is it running?",
    },
    fr: {
      brandSub: "Pipeline OCR → GPT",
      title1: "Lisez n'importe quel document",
      title2: "en quelques secondes",
      lead: "Déposez un reçu, une facture ou un avis bancaire en image ou en PDF. PaddleOCR le lit et GPT extrait l'expéditeur, le montant et la date.",
      progress: "Progression du pipeline",
      stepUpload: "Import",
      inputTitle: "Document",
      dropTitle: "Déposez un fichier ici ou",
      browse: "parcourez",
      dropHint: "PNG, JPG, WEBP ou PDF",
      remove: "Retirer le fichier",
      run: "Extraire les détails",
      running: "Analyse en cours…",
      reading: "Lecture du document…",
      waitHint: "Un PDF est lu page par page et peut prendre une à deux minutes.",
      resultTitle: "Détails du document",
      emptyText: "L'expéditeur, le montant et la date apparaîtront ici.",
      sender: "Expéditeur",
      amount: "Montant",
      date: "Date",
      notFound: "Introuvable",
      page: "Page",
      documents: "documents",
      completed: "Terminé en",
      failedSuffix: "page(s) en échec",
      failedToast: "page(s) n'ont pas pu être lues",
      success: "Détails extraits",
      copy: "Copier les résultats",
      copied: "Copié — collez-le directement dans Excel",
      theme: "Changer de thème",
      errType: "Veuillez choisir une image ou un fichier PDF.",
      errNetwork: "Impossible de joindre le serveur. Est-il démarré ?",
    },
  };
  const store = {
    get(key) { try { return localStorage.getItem(key); } catch (_) { return null; } },
    set(key, value) { try { localStorage.setItem(key, value); } catch (_) {} },
  };
  let lang = store.get("lang") || ((navigator.language || "").startsWith("fr") ? "fr" : "en");
  const t = (key) => I18N[lang][key] ?? I18N.en[key] ?? key;
  let refreshStatus = null; // re-renders the current status line in the active language
  let lastResults = []; // every receipt from the last run, including failed pages

  function applyLang() {
    document.documentElement.lang = lang;
    $$("[data-i18n]").forEach((el) => { el.textContent = t(el.dataset.i18n); });
    $$("[data-i18n-aria]").forEach((el) => {
      el.setAttribute("aria-label", t(el.dataset.i18nAria));
      if (el.title) el.title = t(el.dataset.i18nAria);
    });
    $$(".lang-btn").forEach((b) => b.classList.toggle("active", b.dataset.lang === lang));
    if (runBtn.classList.contains("loading")) $(".btn-label", runBtn).textContent = t("running");
    if (lastResults.length) renderReceipts(lastResults);
    if (refreshStatus) refreshStatus();
  }

  $$(".lang-btn").forEach((b) =>
    b.addEventListener("click", () => {
      lang = b.dataset.lang;
      store.set("lang", lang);
      applyLang();
    })
  );

  /* ---------- Theme ---------- */
  const root = document.documentElement;
  const systemDark = window.matchMedia("(prefers-color-scheme: dark)");
  const currentTheme = () => root.dataset.theme || (systemDark.matches ? "dark" : "light");
  $("#themeToggle").addEventListener("click", () => {
    const next = currentTheme() === "dark" ? "light" : "dark";
    root.dataset.theme = next;
    store.set("theme", next);
  });

  /* ---------- Scroll reveal ---------- */
  const reveals = $$(".reveal");
  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add("visible");
          io.unobserve(entry.target);
        }
      }
    }, { threshold: 0.08 });
    reveals.forEach((el) => io.observe(el));
  } else {
    reveals.forEach((el) => el.classList.add("visible"));
  }

  /* ---------- Toasts ---------- */
  function toast(message, type = "ok") {
    const el = document.createElement("div");
    el.className = `toast ${type === "error" ? "error" : ""}`;
    el.textContent = message;
    $("#toasts").append(el);
    setTimeout(() => {
      el.classList.add("out");
      el.addEventListener("animationend", () => el.remove(), { once: true });
    }, 3200);
  }

  /* ---------- File selection / drag and drop ---------- */
  const isAccepted = (file) => file && (file.type.startsWith("image/") || file.type === "application/pdf" || /\.pdf$/i.test(file.name));
  const formatSize = (bytes) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  };
  let previewUrl = null;

  function showFile(file) {
    const empty = $(".dz-empty", dropzone);
    const filled = $(".dz-file", dropzone);
    const thumb = $("#thumb");
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = null;
    thumb.textContent = "";

    if (!file) {
      empty.hidden = false;
      filled.hidden = true;
      setStep("upload", null);
      return;
    }
    if (file.type.startsWith("image/")) {
      previewUrl = URL.createObjectURL(file);
      const img = new Image();
      img.alt = "";
      img.src = previewUrl;
      thumb.append(img);
    } else {
      thumb.textContent = "PDF";
    }
    $("#fileName").textContent = file.name;
    $("#fileSize").textContent = formatSize(file.size);
    empty.hidden = true;
    filled.hidden = false;
    dropzone.classList.remove("invalid");
    resetSteps();
    setStep("upload", "done");
  }

  function rejectFile() {
    dropzone.classList.remove("invalid");
    void dropzone.offsetWidth; // restart the shake animation
    dropzone.classList.add("invalid");
    toast(t("errType"), "error");
  }

  fileInput.addEventListener("change", () => {
    const file = fileInput.files[0];
    if (file && !isAccepted(file)) {
      fileInput.value = "";
      rejectFile();
      showFile(null);
      return;
    }
    showFile(file);
  });

  dropzone.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      fileInput.click();
    }
  });

  ["dragenter", "dragover"].forEach((type) =>
    dropzone.addEventListener(type, (e) => {
      e.preventDefault();
      dropzone.classList.add("dragover");
    })
  );
  ["dragleave", "drop"].forEach((type) =>
    dropzone.addEventListener(type, (e) => {
      e.preventDefault();
      if (type === "dragleave" && dropzone.contains(e.relatedTarget)) return;
      dropzone.classList.remove("dragover");
    })
  );
  dropzone.addEventListener("drop", (e) => {
    const file = e.dataTransfer.files[0];
    if (!isAccepted(file)) return rejectFile();
    const dt = new DataTransfer();
    dt.items.add(file);
    fileInput.files = dt.files;
    showFile(file);
  });

  $("#clearFile").addEventListener("click", (e) => {
    e.preventDefault(); // don't let the surrounding label reopen the picker
    e.stopPropagation();
    fileInput.value = "";
    showFile(null);
  });

  /* ---------- Stepper ---------- */
  const order = ["upload", "ocr", "llm"];
  function setStep(name, state) {
    const li = $(`.stepper [data-step="${name}"]`);
    li.classList.remove("active", "done", "error");
    if (state) li.classList.add(state);
    // Fill the connector bar that leads out of a completed step.
    const bar = li.nextElementSibling;
    if (bar && bar.classList.contains("bar")) bar.classList.toggle("filled", state === "done");
  }
  function resetSteps() {
    order.forEach((name) => setStep(name, null));
  }

  /* ---------- Results ---------- */
  const ICONS = {
    sender: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18M5 21V7l7-4 7 4v14"/><path d="M9 21v-6h6v6"/></svg>',
    amount: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 12h.01M18 12h.01"/></svg>',
    date: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/></svg>',
  };
  let lastReceipts = []; // only the receipts that were read successfully

  function fieldTile(key, value) {
    const tile = document.createElement("div");
    tile.className = "field-tile";
    tile.innerHTML = `<span class="field-label">${ICONS[key]}${t(key)}</span><span class="field-value ${key}"></span>`;
    const val = $(".field-value", tile);
    if (value) {
      val.textContent = value;
    } else {
      val.textContent = t("notFound");
      val.classList.add("missing");
    }
    return tile;
  }

  function renderReceipts(receipts) {
    receiptsEl.innerHTML = "";
    const multi = receipts.length > 1;
    receipts.forEach((r) => {
      const block = document.createElement("div");
      block.className = "receipt";
      if (multi) {
        const head = document.createElement("div");
        head.className = "receipt-head";
        head.textContent = `${t("page")} ${r.page}`;
        block.append(head);
      }
      if (r.error) {
        const err = document.createElement("div");
        err.className = "receipt-error";
        err.textContent = r.error;
        block.append(err);
      } else {
        const fields = document.createElement("div");
        fields.className = "fields";
        ["sender", "amount", "date"].forEach((k) => fields.append(fieldTile(k, r[k])));
        block.append(fields);
      }
      receiptsEl.append(block);
    });
  }

  function setLoading(loading) {
    $(".skeleton-fields", resultCard).hidden = !loading;
    if (loading) $(".placeholder", resultCard).hidden = true;
  }

  /* ---------- Submit ---------- */
  let timer = null;
  function setStatus(text, kind = "") {
    statusEl.textContent = text;
    statusEl.className = `status ${kind}`;
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!fileInput.files.length) {
      rejectFile();
      return;
    }

    receiptsEl.innerHTML = "";
    $("#resultMeta").textContent = "";
    copyBtn.disabled = true;
    lastReceipts = [];
    lastResults = [];
    refreshStatus = null;
    const file = fileInput.files[0];
    waitHint.hidden = !(file.type === "application/pdf" || /\.pdf$/i.test(file.name));
    setLoading(true);
    resetSteps();
    setStep("upload", "done");
    setStep("ocr", "active");
    runBtn.disabled = true;
    runBtn.classList.add("loading");
    $(".btn-label", runBtn).textContent = t("running");

    const started = performance.now();
    const elapsed = () => ((performance.now() - started) / 1000).toFixed(1);
    refreshStatus = () => setStatus(`${t("reading")} ${elapsed()}s`);
    refreshStatus();
    timer = setInterval(() => refreshStatus(), 100);

    if (window.innerWidth <= 960) {
      resultCard.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    let data;
    try {
      const res = await fetch("/process", { method: "POST", body: new FormData(form) });
      try {
        data = await res.json();
      } catch (_) {
        data = { error: `Server error (HTTP ${res.status})` };
      }
    } catch (err) {
      data = { error: t("errNetwork") };
    } finally {
      clearInterval(timer);
      runBtn.disabled = false;
      runBtn.classList.remove("loading");
      $(".btn-label", runBtn).textContent = t("run");
      waitHint.hidden = true;
      setLoading(false);
    }

    const receipts = data.receipts || [];
    if (receipts.length) {
      // OCR succeeded once the server returns receipts; GPT failed if every receipt errored.
      setStep("ocr", "done");
      const ok = receipts.filter((r) => !r.error);
      setStep("llm", ok.length ? "done" : "error");
      lastResults = receipts;
      renderReceipts(receipts);
      lastReceipts = ok;
      copyBtn.disabled = !ok.length;
      $("#resultMeta").textContent = receipts.length > 1 ? `${receipts.length} ${t("documents")}` : "";
    } else {
      setStep("ocr", "error");
    }
    $(".placeholder", resultCard).hidden = receipts.length > 0;

    const failed = receipts.filter((r) => r.error).length;
    const seconds = elapsed();
    if (data.error) {
      refreshStatus = () => setStatus(data.error, "error");
      toast(data.error, "error");
    } else if (failed) {
      refreshStatus = () => setStatus(`${t("completed")} ${seconds}s · ${failed} ${t("failedSuffix")}`, "error");
      toast(`${failed} ${t("failedToast")}`, "error");
    } else {
      refreshStatus = () => setStatus(`${t("completed")} ${seconds}s`, "ok");
      toast(t("success"));
    }
    refreshStatus();
  });

  /* ---------- Copy ---------- */
  copyBtn.addEventListener("click", async () => {
    const text = [[t("sender"), t("amount"), t("date")].join("\t")]
      .concat(lastReceipts.map((r) => [r.sender, r.amount, r.date].map((v) => v ?? "").join("\t")))
      .join("\n");
    try {
      await navigator.clipboard.writeText(text);
    } catch (_) {
      const tmp = document.createElement("textarea");
      tmp.value = text;
      document.body.append(tmp);
      tmp.select();
      document.execCommand("copy");
      tmp.remove();
    }
    copyBtn.classList.add("copied");
    toast(t("copied"));
    setTimeout(() => copyBtn.classList.remove("copied"), 1500);
  });

  applyLang();
})();
