import { useState, useEffect } from "react";
import * as XLSX from "xlsx";
import { storage } from "./lib/storage";

function genId(prefix) {
  return prefix + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function slugify(str) {
  return String(str)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

const DEFAULT_QUESTION_TEXTS = [
  "Saya merasa percaya diri saat berbicara di depan kamera.",
  "Saya mampu menjaga kontak mata dengan audiens virtual.",
  "Saya mampu mengatur intonasi suara agar tidak monoton.",
  "Saya nyaman menggunakan tools presentasi virtual (OBS, breakout room, dll).",
  "Saya mampu menyusun slide yang mudah dipahami audiens.",
  "Saya mampu mengelola waktu presentasi dengan baik.",
  "Saya mampu menangani pertanyaan sulit dari audiens.",
  "Saya mampu membangun interaksi dengan audiens virtual.",
  "Saya merasa siap menghadapi gangguan teknis saat presentasi.",
  "Saya mampu menutup presentasi dengan kuat dan berkesan.",
];

const DEFAULT_FIELDS = [
  { id: "name", label: "Nama", type: "text", required: true },
  { id: "instansi", label: "Email / Instansi", type: "text", required: true },
];

const FIELD_TYPES = [
  { value: "text", label: "Teks" },
  { value: "email", label: "Email" },
  { value: "tel", label: "Nomor HP" },
];

const SCALE_OPTIONS = [4, 5, 10];

function newQuestion(text) {
  return { id: genId("q"), text: text || "", scoreMode: "normal", manualScores: {} };
}

function defaultConfig(title) {
  return {
    title: title || "Asesmen Baru",
    subtitle: "Jawab sesuai kondisi Anda saat ini. Tidak ada jawaban salah.",
    minLabel: "Sangat Tidak Setuju",
    maxLabel: "Sangat Setuju",
    scaleMax: 5,
    fields: DEFAULT_FIELDS.map((f) => ({ ...f })),
    questions: DEFAULT_QUESTION_TEXTS.map((t) => newQuestion(t)),
    closed: false,
  };
}

// Menjaga kompatibilitas dengan data lama (pertanyaan berupa string polos,
// scaleMax belum ada, dll) supaya tidak error saat dibaca ulang.
function normalizeConfig(raw) {
  const base = defaultConfig(raw && raw.title);
  const cfg = { ...base, ...raw };
  cfg.fields = raw && Array.isArray(raw.fields) && raw.fields.length ? raw.fields : base.fields;
  cfg.scaleMax = raw && SCALE_OPTIONS.includes(raw.scaleMax) ? raw.scaleMax : base.scaleMax;
  const srcQuestions = (raw && Array.isArray(raw.questions) && raw.questions.length) ? raw.questions : base.questions;
  cfg.questions = srcQuestions.map((q) =>
    typeof q === "string"
      ? newQuestion(q)
      : {
          id: q.id || genId("q"),
          text: q.text || "",
          scoreMode: q.scoreMode === "manual" ? "manual" : "normal",
          manualScores: q.manualScores && typeof q.manualScores === "object" ? q.manualScores : {},
        }
  );
  return cfg;
}

function ensureManualScores(q, scaleMax) {
  const out = {};
  for (let v = 1; v <= scaleMax; v++) {
    const raw = q.manualScores ? q.manualScores[v] : undefined;
    out[v] = raw !== undefined && raw !== null && raw !== "" && !Number.isNaN(Number(raw)) ? Number(raw) : v;
  }
  return out;
}

function questionPoints(q, selectedValue, scaleMax) {
  if (!selectedValue) return 0;
  if (q.scoreMode === "manual") {
    const scores = ensureManualScores(q, scaleMax);
    return scores[selectedValue] !== undefined ? scores[selectedValue] : selectedValue;
  }
  return selectedValue;
}

function questionMaxPoints(q, scaleMax) {
  if (q.scoreMode === "manual") {
    const scores = ensureManualScores(q, scaleMax);
    return Math.max(...Object.values(scores));
  }
  return scaleMax;
}

const ASSESSMENT_PREFIX = "assessment:";
const RESP_PREFIX = "resp:";
const MASTER_CODE_KEY = "master-admin";
const DEFAULT_MASTER_CODE = "1234";

const COLORS = {
  ink: "#16202B",
  paper: "#F3F4F1",
  card: "#FFFFFF",
  teal: "#1F8A70",
  tealDark: "#166E5A",
  gold: "#D9A441",
  line: "#E3E5E1",
  muted: "#6B7280",
  danger: "#C1502E",
};

const FONT_STACK = {
  display: "'Sora', 'Segoe UI', system-ui, sans-serif",
  body: "'Inter', 'Segoe UI', system-ui, sans-serif",
};

export default function AssessmentApp() {
  const [assessmentId] = useState(() => {
    try {
      return new URLSearchParams(window.location.search).get("id") || "";
    } catch (e) {
      return "";
    }
  });

  const [view, setView] = useState("loading");

  // ---- audience-facing (assessment loaded from URL ?id=) ----
  const [audienceConfig, setAudienceConfig] = useState(null);
  const [formValues, setFormValues] = useState({});
  const [answers, setAnswers] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [lastTotal, setLastTotal] = useState(null);
  const [formErr, setFormErr] = useState("");

  // ---- admin: master gate ----
  const [masterCode, setMasterCode] = useState(DEFAULT_MASTER_CODE);
  const [adminCodeInput, setAdminCodeInput] = useState("");
  const [adminErr, setAdminErr] = useState("");
  const [masterCodeDraft, setMasterCodeDraft] = useState("");
  const [masterCodeMsg, setMasterCodeMsg] = useState("");

  // ---- admin: list of assessments ----
  const [assessmentList, setAssessmentList] = useState([]);
  const [loadingList, setLoadingList] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newSlug, setNewSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [createErr, setCreateErr] = useState("");
  const [copiedId, setCopiedId] = useState("");

  // ---- admin: editing one assessment ----
  const [editingId, setEditingId] = useState("");
  const [editConfig, setEditConfig] = useState(null);
  const [draft, setDraft] = useState(null);
  const [adminTab, setAdminTab] = useState("settings");
  const [responses, setResponses] = useState([]);
  const [loadingResponses, setLoadingResponses] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const mc = await storage.get(MASTER_CODE_KEY, true);
        if (!cancelled && mc && mc.value) {
          const parsed = JSON.parse(mc.value);
          if (parsed.code) setMasterCode(parsed.code);
        }
      } catch (e) {
        /* pakai default */
      }

      if (!assessmentId) {
        if (!cancelled) setView("not-found");
        return;
      }
      try {
        const res = await storage.get(ASSESSMENT_PREFIX + assessmentId, true);
        if (cancelled) return;
        if (res && res.value) {
          const parsed = normalizeConfig(JSON.parse(res.value));
          setAudienceConfig(parsed);
          setView(parsed.closed ? "closed" : "form");
        } else {
          setView("not-found");
        }
      } catch (e) {
        if (!cancelled) setView("not-found");
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [assessmentId]);

  useEffect(() => {
    if (audienceConfig && audienceConfig.title) {
      document.title = audienceConfig.title;
    }
  }, [audienceConfig]);

  function handleFieldChange(fieldId, val) {
    setFormValues((prev) => ({ ...prev, [fieldId]: val }));
    setFormErr("");
  }

  function handleSelect(qIdx, val) {
    setAnswers((prev) => ({ ...prev, [qIdx]: val }));
    setFormErr("");
  }

  const answeredCount = Object.keys(answers).length;
  const totalQuestions = audienceConfig ? audienceConfig.questions.length : 0;
  const scaleMax = audienceConfig ? audienceConfig.scaleMax || 5 : 5;
  const maxTotalPoints = audienceConfig
    ? audienceConfig.questions.reduce((sum, q) => sum + questionMaxPoints(q, scaleMax), 0)
    : 0;

  async function handleSubmit() {
    for (const f of audienceConfig.fields) {
      if (f.required && !(formValues[f.id] || "").trim()) {
        setFormErr(`"${f.label}" wajib diisi.`);
        return;
      }
    }
    if (answeredCount < totalQuestions) {
      setFormErr("Semua pertanyaan wajib dijawab sebelum mengirim.");
      return;
    }
    setFormErr("");
    setSubmitting(true);
    const total = audienceConfig.questions.reduce(
      (sum, q, i) => sum + questionPoints(q, answers[i], scaleMax),
      0
    );
    const id = RESP_PREFIX + assessmentId + ":" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
    const payload = {
      values: formValues,
      answers,
      total,
      timestamp: new Date().toISOString(),
    };
    try {
      await storage.set(id, JSON.stringify(payload), true);
      setLastTotal(total);
      setView("thankyou");
    } catch (e) {
      setFormErr("Gagal menyimpan jawaban. Silakan coba lagi.");
    } finally {
      setSubmitting(false);
    }
  }

  function openAdminGate() {
    setAdminCodeInput("");
    setAdminErr("");
    setView("admin-gate");
  }

  function backToAudienceView() {
    if (!assessmentId) {
      setView("not-found");
    } else if (audienceConfig) {
      setView(audienceConfig.closed ? "closed" : "form");
    } else {
      setView("not-found");
    }
  }

  function checkMasterCode() {
    if (adminCodeInput === masterCode) {
      setAdminErr("");
      setMasterCodeDraft(masterCode);
      setMasterCodeMsg("");
      setView("admin-list");
      loadAssessmentList();
    } else {
      setAdminErr("Kode akses salah.");
    }
  }

  async function saveMasterCode() {
    setMasterCodeMsg("");
    if (!masterCodeDraft.trim()) {
      setMasterCodeMsg("Kode tidak boleh kosong.");
      return;
    }
    try {
      const res = await storage.set(MASTER_CODE_KEY, JSON.stringify({ code: masterCodeDraft.trim() }), true);
      if (res) {
        setMasterCode(masterCodeDraft.trim());
        setMasterCodeMsg("Kode akses admin diperbarui.");
      } else {
        setMasterCodeMsg("Gagal menyimpan.");
      }
    } catch (e) {
      setMasterCodeMsg("Gagal menyimpan.");
    }
  }

  async function loadAssessmentList() {
    setLoadingList(true);
    try {
      const res = await storage.listWithValues(ASSESSMENT_PREFIX, true);
      const rows = res && res.items ? res.items : [];
      const items = [];
      for (const row of rows) {
        try {
          if (!row.value) continue;
          const cfg = JSON.parse(row.value);
          items.push({ id: row.key.slice(ASSESSMENT_PREFIX.length), title: cfg.title, closed: cfg.closed });
        } catch (e) {
          /* lewati entri rusak */
        }
      }
      items.sort((a, b) => a.title.localeCompare(b.title));
      setAssessmentList(items);
    } catch (e) {
      setAssessmentList([]);
    } finally {
      setLoadingList(false);
    }
  }

  function handleNewTitleChange(val) {
    setNewTitle(val);
    if (!slugTouched) setNewSlug(slugify(val));
  }

  async function createAssessment() {
    setCreateErr("");
    const title = newTitle.trim();
    const slug = slugify(newSlug);
    if (!title) {
      setCreateErr("Judul asesmen wajib diisi.");
      return;
    }
    if (!slug) {
      setCreateErr("ID link wajib diisi (huruf/angka/tanda strip).");
      return;
    }
    if (assessmentList.some((a) => a.id === slug)) {
      setCreateErr("ID link ini sudah dipakai asesmen lain. Pilih ID lain.");
      return;
    }
    try {
      const cfg = defaultConfig(title);
      const res = await storage.set(ASSESSMENT_PREFIX + slug, JSON.stringify(cfg), true);
      if (!res) {
        setCreateErr("Gagal membuat asesmen.");
        return;
      }
      setNewTitle("");
      setNewSlug("");
      setSlugTouched(false);
      await loadAssessmentList();
      openEditAssessment(slug, cfg);
    } catch (e) {
      setCreateErr("Gagal membuat asesmen.");
    }
  }

  async function openEditAssessment(id, preloadedCfg) {
    setEditingId(id);
    setSaveMsg("");
    setAdminTab("settings");
    let cfg = preloadedCfg;
    if (!cfg) {
      try {
        const res = await storage.get(ASSESSMENT_PREFIX + id, true);
        cfg = res && res.value ? JSON.parse(res.value) : defaultConfig();
      } catch (e) {
        cfg = defaultConfig();
      }
    }
    cfg = normalizeConfig(cfg);
    setEditConfig(cfg);
    setDraft({
      ...cfg,
      fields: cfg.fields.map((f) => ({ ...f })),
      questions: cfg.questions.map((q) => ({ ...q, manualScores: { ...q.manualScores } })),
    });
    setView("admin-edit");
    loadResponses(id);
  }

  async function loadResponses(id) {
    setLoadingResponses(true);
    try {
      const res = await storage.listWithValues(RESP_PREFIX + id + ":", true);
      const rows = res && res.items ? res.items : [];
      const items = [];
      for (const row of rows) {
        try {
          if (!row.value) continue;
          items.push({ key: row.key, ...JSON.parse(row.value) });
        } catch (e) {
          /* skip broken entry */
        }
      }
      items.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
      setResponses(items);
    } catch (e) {
      setResponses([]);
    } finally {
      setLoadingResponses(false);
    }
  }

  function validateDraft() {
    if (draft.fields.length === 0) return "Minimal harus ada 1 kolom informasi.";
    if (draft.fields.some((f) => !f.label.trim())) return "Ada kolom informasi dengan label kosong.";
    const cleanQ = draft.questions.filter((q) => q.text.trim());
    if (cleanQ.length === 0) return "Minimal harus ada 1 pertanyaan.";
    return "";
  }

  async function saveConfig() {
    setSaveMsg("");
    const err = validateDraft();
    if (err) {
      setSaveMsg(err);
      return;
    }
    const cleaned = { ...draft, questions: draft.questions.filter((q) => q.text.trim()) };
    try {
      const res = await storage.set(ASSESSMENT_PREFIX + editingId, JSON.stringify(cleaned), true);
      if (res) {
        setEditConfig(cleaned);
        setDraft({
          ...cleaned,
          fields: cleaned.fields.map((f) => ({ ...f })),
          questions: cleaned.questions.map((q) => ({ ...q, manualScores: { ...q.manualScores } })),
        });
        setSaveMsg("Perubahan tersimpan.");
        setAssessmentList((prev) =>
          prev.map((a) => (a.id === editingId ? { ...a, title: cleaned.title, closed: cleaned.closed } : a))
        );
      } else {
        setSaveMsg("Gagal menyimpan perubahan.");
      }
    } catch (e) {
      setSaveMsg("Gagal menyimpan perubahan.");
    }
  }

  function updateDraftQuestion(i, patch) {
    setDraft((prev) => {
      const qs = [...prev.questions];
      qs[i] = { ...qs[i], ...patch };
      return { ...prev, questions: qs };
    });
  }

  function updateManualScore(i, choiceValue, rawInput) {
    setDraft((prev) => {
      const qs = [...prev.questions];
      const q = qs[i];
      const scores = { ...(q.manualScores || {}) };
      scores[choiceValue] = rawInput === "" ? "" : Number(rawInput);
      qs[i] = { ...q, manualScores: scores };
      return { ...prev, questions: qs };
    });
  }

  function addQuestion() {
    setDraft((prev) => ({ ...prev, questions: [...prev.questions, newQuestion("")] }));
  }

  function removeQuestion(i) {
    setDraft((prev) => {
      const qs = [...prev.questions];
      qs.splice(i, 1);
      return { ...prev, questions: qs };
    });
  }

  function updateDraftField(i, patch) {
    setDraft((prev) => {
      const fs = [...prev.fields];
      fs[i] = { ...fs[i], ...patch };
      return { ...prev, fields: fs };
    });
  }

  function addField() {
    setDraft((prev) => ({
      ...prev,
      fields: [...prev.fields, { id: genId("f"), label: "Kolom Baru", type: "text", required: true }],
    }));
  }

  function removeField(i) {
    setDraft((prev) => {
      const fs = [...prev.fields];
      fs.splice(i, 1);
      return { ...prev, fields: fs };
    });
  }

  function exportExcel() {
    const scaleMaxForExport = editConfig.scaleMax || 5;
    const rows = responses.map((r, i) => {
      const row = { No: i + 1 };
      editConfig.fields.forEach((f) => {
        row[f.label] = (r.values || {})[f.id] || "";
      });
      editConfig.questions.forEach((q, qi) => {
        const selected = r.answers[qi];
        row["Q" + (qi + 1) + " (jawaban)"] = selected;
        if (q.scoreMode === "manual") {
          row["Q" + (qi + 1) + " (poin)"] = questionPoints(q, selected, scaleMaxForExport);
        }
      });
      row["Total Poin"] = r.total;
      row["Waktu"] = new Date(r.timestamp).toLocaleString("id-ID");
      return row;
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Hasil Asesmen");
    XLSX.writeFile(wb, "hasil-" + editingId + "-" + Date.now() + ".xlsx");
  }

  async function clearResponses() {
    if (!window.confirm("Hapus semua data hasil asesmen ini? Tindakan ini tidak bisa dibatalkan.")) return;
    try {
      await storage.deleteByPrefix(RESP_PREFIX + editingId + ":", true);
      setResponses([]);
      setSaveMsg("Semua data hasil telah dihapus.");
    } catch (e) {
      setSaveMsg("Gagal menghapus data.");
    }
  }

  async function deleteAssessment(id, title) {
    if (!window.confirm(`Hapus asesmen "${title}" beserta semua hasilnya? Tindakan ini tidak bisa dibatalkan.`)) return;
    try {
      await storage.delete(ASSESSMENT_PREFIX + id, true);
      await storage.deleteByPrefix(RESP_PREFIX + id + ":", true);
      setAssessmentList((prev) => prev.filter((a) => a.id !== id));
    } catch (e) {
      window.alert("Gagal menghapus sebagian data.");
    }
  }

  function assessmentLink(id) {
    return `${window.location.origin}${window.location.pathname}?id=${id}`;
  }

  async function copyLink(id) {
    const link = assessmentLink(id);
    try {
      await navigator.clipboard.writeText(link);
      setCopiedId(id);
      setTimeout(() => setCopiedId(""), 2000);
    } catch (e) {
      window.prompt("Salin link ini secara manual:", link);
    }
  }

  const wrap = {
    minHeight: "100%",
    background: COLORS.paper,
    fontFamily: FONT_STACK.body,
    color: COLORS.ink,
    padding: "32px 16px 64px",
    boxSizing: "border-box",
  };

  const card = {
    maxWidth: 640,
    margin: "0 auto",
    background: COLORS.card,
    borderRadius: 16,
    boxShadow: "0 1px 3px rgba(22,32,43,0.08), 0 8px 24px rgba(22,32,43,0.06)",
    overflow: "hidden",
    border: `1px solid ${COLORS.line}`,
  };

  const spotlightBar = {
    height: 6,
    width: "100%",
    background: `linear-gradient(90deg, ${COLORS.teal}, ${COLORS.gold})`,
  };

  const globalStyle = (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Sora:wght@600;700&family=Inter:wght@400;500;600&display=swap');
      .aa-btn { cursor: pointer; border: none; font-family: ${FONT_STACK.body}; transition: background .15s ease, transform .1s ease, box-shadow .15s ease; }
      .aa-btn:active { transform: translateY(1px); }
      .aa-btn:disabled { cursor: not-allowed; opacity: .55; }
      .aa-btn:focus-visible, .aa-scale-btn:focus-visible, .aa-input:focus-visible, .aa-input:focus, .aa-select:focus-visible {
        outline: 2px solid ${COLORS.teal}; outline-offset: 2px;
      }
      .aa-primary { background: ${COLORS.teal}; color: #fff; }
      .aa-primary:hover:not(:disabled) { background: ${COLORS.tealDark}; }
      .aa-ghost { background: transparent; color: ${COLORS.muted}; }
      .aa-ghost:hover { color: ${COLORS.ink}; }
      .aa-input, .aa-select { font-family: ${FONT_STACK.body}; border: 1px solid ${COLORS.line}; border-radius: 8px; padding: 10px 12px; font-size: 14px; width: 100%; box-sizing: border-box; background: #fff; }
      textarea.aa-input { resize: vertical; line-height: 1.5; }
      .aa-scale-row { display: flex; gap: 8px; flex-wrap: wrap; }
      .aa-scale-btn { width: 44px; height: 44px; border-radius: 50%; border: 1.5px solid ${COLORS.line}; background: #fff; font-family: ${FONT_STACK.display}; font-weight: 600; font-size: 15px; color: ${COLORS.ink}; cursor: pointer; transition: all .15s ease; }
      .aa-scale-btn:hover { border-color: ${COLORS.teal}; }
      .aa-scale-btn.selected { background: ${COLORS.teal}; border-color: ${COLORS.teal}; color: #fff; }
      .aa-icon-btn { width: 30px; height: 30px; border-radius: 6px; border: 1px solid ${COLORS.line}; background: #fff; color: ${COLORS.danger}; font-size: 15px; line-height: 1; cursor: pointer; flex-shrink: 0; }
      .aa-icon-btn:hover { background: #FBEAE4; }
      .aa-score-box { display: flex; flex-direction: column; align-items: center; gap: 4px; }
      .aa-score-box input { width: 48px; text-align: center; border: 1px solid ${COLORS.line}; border-radius: 6px; padding: 6px 2px; font-size: 13px; font-family: ${FONT_STACK.body}; }
      table.aa-table { width: 100%; border-collapse: collapse; font-size: 13px; }
      table.aa-table th, table.aa-table td { text-align: left; padding: 8px 10px; border-bottom: 1px solid ${COLORS.line}; white-space: nowrap; }
      table.aa-table th { color: ${COLORS.muted}; font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: .03em; }
      .aa-row-card { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 12px 14px; border: 1px solid ${COLORS.line}; border-radius: 10px; }
      @media (max-width: 480px) {
        .aa-scale-btn { width: 34px; height: 34px; font-size: 12px; }
        .aa-row-card { flex-direction: column; align-items: stretch; }
      }
    `}</style>
  );

  if (view === "loading") {
    return (
      <div style={{ ...wrap, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ color: COLORS.muted, fontFamily: FONT_STACK.body }}>Memuat…</div>
      </div>
    );
  }

  return (
    <div style={wrap}>
      {globalStyle}

      {/* ================= FORM VIEW (AUDIENS) ================= */}
      {view === "form" && audienceConfig && (
        <div style={card}>
          <div style={spotlightBar} />
          <div style={{ padding: "28px 28px 24px" }}>
            <h1 style={{ fontFamily: FONT_STACK.display, fontSize: 22, fontWeight: 700, margin: "0 0 6px" }}>
              {audienceConfig.title}
            </h1>
            <p style={{ color: COLORS.muted, fontSize: 14, margin: "0 0 24px", lineHeight: 1.6, whiteSpace: "pre-line" }}>
              {audienceConfig.subtitle}
            </p>

            <div style={{ display: "grid", gap: 14, marginBottom: 24 }}>
              {audienceConfig.fields.map((f) => (
                <div key={f.id}>
                  <label style={{ fontSize: 13, fontWeight: 600, marginBottom: 6, display: "block" }}>
                    {f.label}
                    {f.required ? "" : " (opsional)"}
                  </label>
                  <input
                    className="aa-input"
                    type={f.type === "email" ? "email" : f.type === "tel" ? "tel" : "text"}
                    value={formValues[f.id] || ""}
                    onChange={(e) => handleFieldChange(f.id, e.target.value)}
                    placeholder={f.label}
                  />
                </div>
              ))}
            </div>

            <div style={{ height: 6, borderRadius: 3, background: COLORS.line, overflow: "hidden", marginBottom: 6 }}>
              <div
                style={{
                  height: "100%",
                  width: `${(answeredCount / totalQuestions) * 100}%`,
                  background: COLORS.gold,
                  transition: "width .2s ease",
                }}
              />
            </div>
            <div style={{ fontSize: 12, color: COLORS.muted, marginBottom: 20 }}>
              {answeredCount} dari {totalQuestions} pertanyaan terjawab
            </div>

            <div style={{ display: "grid", gap: 22 }}>
              {audienceConfig.questions.map((q, i) => (
                <div key={q.id}>
                  <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 10, lineHeight: 1.5 }}>
                    {i + 1}. {q.text}
                  </div>
                  <div className="aa-scale-row">
                    {Array.from({ length: scaleMax }, (_, idx) => idx + 1).map((val) => (
                      <button
                        key={val}
                        type="button"
                        className={"aa-scale-btn" + (answers[i] === val ? " selected" : "")}
                        onClick={() => handleSelect(i, val)}
                        aria-label={`Skala ${val}`}
                      >
                        {val}
                      </button>
                    ))}
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: COLORS.muted, marginTop: 6 }}>
                    <span>{audienceConfig.minLabel}</span>
                    <span>{audienceConfig.maxLabel}</span>
                  </div>
                </div>
              ))}
            </div>

            {formErr && <div style={{ color: COLORS.danger, fontSize: 13, marginTop: 18 }}>{formErr}</div>}

            <button
              className="aa-btn aa-primary"
              style={{ marginTop: 22, width: "100%", padding: "13px", borderRadius: 10, fontSize: 15, fontWeight: 600 }}
              onClick={handleSubmit}
              disabled={submitting}
            >
              {submitting ? "Mengirim…" : "Kirim Jawaban"}
            </button>
          </div>
        </div>
      )}

      {/* ================= THANK YOU VIEW ================= */}
      {view === "thankyou" && (
        <div style={card}>
          <div style={spotlightBar} />
          <div style={{ padding: "40px 28px", textAlign: "center" }}>
            <div style={{ fontSize: 13, color: COLORS.muted, marginBottom: 8 }}>Terima kasih telah menjawab</div>
            <div style={{ fontFamily: FONT_STACK.display, fontSize: 15, marginBottom: 4 }}>Total poin Anda adalah</div>
            <div style={{ fontFamily: FONT_STACK.display, fontSize: 48, fontWeight: 700, color: COLORS.teal, margin: "4px 0 18px" }}>
              {lastTotal}
            </div>
            <div style={{ fontSize: 13, color: COLORS.muted }}>dari maksimal {maxTotalPoints} poin</div>
          </div>
        </div>
      )}

      {/* ================= CLOSED VIEW ================= */}
      {view === "closed" && (
        <div style={card}>
          <div style={spotlightBar} />
          <div style={{ padding: "40px 28px", textAlign: "center" }}>
            <div style={{ fontFamily: FONT_STACK.display, fontSize: 18, fontWeight: 700, marginBottom: 8 }}>
              Asesmen sudah ditutup
            </div>
            <div style={{ fontSize: 14, color: COLORS.muted }}>
              Silakan hubungi penyelenggara untuk informasi lebih lanjut.
            </div>
          </div>
        </div>
      )}

      {/* ================= NOT FOUND / LANDING ================= */}
      {view === "not-found" && (
        <div style={card}>
          <div style={spotlightBar} />
          <div style={{ padding: "40px 28px", textAlign: "center" }}>
            <div style={{ fontFamily: FONT_STACK.display, fontSize: 18, fontWeight: 700, marginBottom: 8 }}>
              Asesmen tidak ditemukan
            </div>
            <div style={{ fontSize: 14, color: COLORS.muted }}>
              Link ini tidak valid atau asesmen sudah tidak tersedia. Hubungi penyelenggara untuk link yang benar.
            </div>
          </div>
        </div>
      )}

      {/* ================= ADMIN GATE ================= */}
      {view === "admin-gate" && (
        <div style={{ ...card, maxWidth: 380 }}>
          <div style={spotlightBar} />
          <div style={{ padding: 28 }}>
            <div style={{ fontFamily: FONT_STACK.display, fontSize: 17, fontWeight: 700, marginBottom: 14 }}>
              Masuk sebagai Admin
            </div>
            <input
              className="aa-input"
              type="password"
              placeholder="Kode akses"
              value={adminCodeInput}
              onChange={(e) => setAdminCodeInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && checkMasterCode()}
            />
            {adminErr && <div style={{ color: COLORS.danger, fontSize: 13, marginTop: 8 }}>{adminErr}</div>}
            <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
              <button className="aa-btn aa-primary" style={{ flex: 1, padding: "10px", borderRadius: 8, fontWeight: 600 }} onClick={checkMasterCode}>
                Masuk
              </button>
              <button className="aa-btn aa-ghost" style={{ padding: "10px" }} onClick={backToAudienceView}>
                Batal
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ================= ADMIN: DAFTAR ASESMEN ================= */}
      {view === "admin-list" && (
        <div style={{ ...card, maxWidth: 760 }}>
          <div style={spotlightBar} />
          <div style={{ padding: "24px 28px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
              <div style={{ fontFamily: FONT_STACK.display, fontSize: 18, fontWeight: 700 }}>Daftar Asesmen</div>
              <button className="aa-btn aa-ghost" style={{ fontSize: 13 }} onClick={backToAudienceView}>
                Keluar
              </button>
            </div>

            <div style={{ marginBottom: 24, padding: 16, background: COLORS.paper, borderRadius: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Buat Asesmen Baru</div>
              <div style={{ display: "grid", gap: 8 }}>
                <input
                  className="aa-input"
                  placeholder="Judul asesmen, mis. Training Sales Batch Januari"
                  value={newTitle}
                  onChange={(e) => handleNewTitleChange(e.target.value)}
                />
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span style={{ fontSize: 12, color: COLORS.muted, whiteSpace: "nowrap" }}>?id=</span>
                  <input
                    className="aa-input"
                    placeholder="id-link-asesmen"
                    value={newSlug}
                    onChange={(e) => {
                      setSlugTouched(true);
                      setNewSlug(slugify(e.target.value));
                    }}
                  />
                </div>
                {createErr && <div style={{ color: COLORS.danger, fontSize: 13 }}>{createErr}</div>}
                <button
                  className="aa-btn aa-primary"
                  style={{ padding: "10px 16px", borderRadius: 8, fontWeight: 600, justifySelf: "start" }}
                  onClick={createAssessment}
                >
                  + Buat Asesmen
                </button>
              </div>
            </div>

            <div style={{ marginBottom: 20, padding: 16, border: `1px solid ${COLORS.line}`, borderRadius: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Kode Akses Admin</div>
              <div style={{ display: "flex", gap: 8 }}>
                <input className="aa-input" value={masterCodeDraft} onChange={(e) => setMasterCodeDraft(e.target.value)} />
                <button
                  className="aa-btn"
                  style={{ padding: "10px 16px", borderRadius: 8, fontWeight: 600, background: COLORS.ink, color: "#fff", whiteSpace: "nowrap" }}
                  onClick={saveMasterCode}
                >
                  Simpan
                </button>
              </div>
              {masterCodeMsg && <div style={{ fontSize: 12, color: COLORS.muted, marginTop: 6 }}>{masterCodeMsg}</div>}
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>Semua Asesmen ({assessmentList.length})</div>
              <button className="aa-btn aa-ghost" style={{ fontSize: 12 }} onClick={loadAssessmentList}>
                {loadingList ? "Memuat…" : "Muat Ulang"}
              </button>
            </div>

            {assessmentList.length === 0 ? (
              <div style={{ fontSize: 13, color: COLORS.muted, padding: "16px 0" }}>Belum ada asesmen dibuat.</div>
            ) : (
              <div style={{ display: "grid", gap: 10 }}>
                {assessmentList.map((a) => (
                  <div key={a.id} className="aa-row-card">
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 2 }}>{a.title}</div>
                      <div style={{ fontSize: 12, color: COLORS.muted, overflow: "hidden", textOverflow: "ellipsis" }}>
                        {assessmentLink(a.id)} {a.closed ? "· ditutup" : ""}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                      <button className="aa-btn" style={{ padding: "7px 12px", borderRadius: 7, fontSize: 12, border: `1px solid ${COLORS.line}`, background: "#fff" }} onClick={() => copyLink(a.id)}>
                        {copiedId === a.id ? "Tersalin!" : "Salin Link"}
                      </button>
                      <button className="aa-btn aa-primary" style={{ padding: "7px 12px", borderRadius: 7, fontSize: 12, fontWeight: 600 }} onClick={() => openEditAssessment(a.id)}>
                        Kelola
                      </button>
                      <button className="aa-icon-btn" onClick={() => deleteAssessment(a.id, a.title)} title="Hapus asesmen">
                        ✕
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ================= ADMIN: EDIT SATU ASESMEN ================= */}
      {view === "admin-edit" && draft && (
        <div style={{ ...card, maxWidth: 780 }}>
          <div style={spotlightBar} />
          <div style={{ padding: "24px 28px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <div style={{ fontFamily: FONT_STACK.display, fontSize: 18, fontWeight: 700 }}>{editConfig.title}</div>
              <button className="aa-btn aa-ghost" style={{ fontSize: 13 }} onClick={() => setView("admin-list")}>
                ← Daftar Asesmen
              </button>
            </div>
            <div style={{ fontSize: 12, color: COLORS.muted, marginBottom: 18 }}>{assessmentLink(editingId)}</div>

            <div style={{ display: "flex", gap: 4, marginBottom: 20, borderBottom: `1px solid ${COLORS.line}` }}>
              {["settings", "fields", "results"].map((t) => (
                <button
                  key={t}
                  className="aa-btn"
                  onClick={() => setAdminTab(t)}
                  style={{
                    padding: "10px 4px",
                    marginRight: 20,
                    background: "transparent",
                    fontWeight: 600,
                    fontSize: 14,
                    color: adminTab === t ? COLORS.ink : COLORS.muted,
                    borderBottom: adminTab === t ? `2px solid ${COLORS.teal}` : "2px solid transparent",
                    borderRadius: 0,
                  }}
                >
                  {t === "settings" ? "Pertanyaan" : t === "fields" ? "Form Informasi" : `Hasil (${responses.length})`}
                </button>
              ))}
            </div>

            {adminTab === "settings" && (
              <div style={{ display: "grid", gap: 16 }}>
                <div>
                  <label style={{ fontSize: 13, fontWeight: 600, marginBottom: 6, display: "block" }}>Judul Asesmen</label>
                  <input className="aa-input" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
                </div>
                <div>
                  <label style={{ fontSize: 13, fontWeight: 600, marginBottom: 6, display: "block" }}>
                    Subjudul / Keterangan <span style={{ fontWeight: 400, color: COLORS.muted }}>(Enter untuk baris baru)</span>
                  </label>
                  <textarea
                    className="aa-input"
                    rows={4}
                    value={draft.subtitle}
                    onChange={(e) => setDraft({ ...draft, subtitle: e.target.value })}
                  />
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div>
                    <label style={{ fontSize: 13, fontWeight: 600, marginBottom: 6, display: "block" }}>Label Skala Terendah (1)</label>
                    <input className="aa-input" value={draft.minLabel} onChange={(e) => setDraft({ ...draft, minLabel: e.target.value })} />
                  </div>
                  <div>
                    <label style={{ fontSize: 13, fontWeight: 600, marginBottom: 6, display: "block" }}>Label Skala Tertinggi</label>
                    <input className="aa-input" value={draft.maxLabel} onChange={(e) => setDraft({ ...draft, maxLabel: e.target.value })} />
                  </div>
                </div>

                <div>
                  <label style={{ fontSize: 13, fontWeight: 600, marginBottom: 6, display: "block" }}>Skala Penilaian</label>
                  <select
                    className="aa-select"
                    value={draft.scaleMax || 5}
                    onChange={(e) => setDraft({ ...draft, scaleMax: Number(e.target.value) })}
                  >
                    {SCALE_OPTIONS.map((n) => (
                      <option key={n} value={n}>
                        1 – {n}
                      </option>
                    ))}
                  </select>
                  <div style={{ fontSize: 12, color: COLORS.muted, marginTop: 6 }}>
                    Perubahan skala hanya berlaku untuk pengisian baru; jawaban yang sudah masuk tidak berubah.
                  </div>
                </div>

                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                    <label style={{ fontSize: 13, fontWeight: 600 }}>Pertanyaan ({draft.questions.length})</label>
                    <button
                      className="aa-btn"
                      style={{ fontSize: 12, fontWeight: 600, color: COLORS.teal, background: "transparent" }}
                      onClick={addQuestion}
                    >
                      + Tambah Pertanyaan
                    </button>
                  </div>
                  <div style={{ display: "grid", gap: 10 }}>
                    {draft.questions.map((q, i) => (
                      <div key={q.id} style={{ padding: 10, background: COLORS.paper, borderRadius: 8 }}>
                        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                          <span style={{ fontSize: 12, color: COLORS.muted, width: 18 }}>{i + 1}.</span>
                          <input
                            className="aa-input"
                            style={{ background: "#fff" }}
                            value={q.text}
                            onChange={(e) => updateDraftQuestion(i, { text: e.target.value })}
                          />
                          <button className="aa-icon-btn" onClick={() => removeQuestion(i)} title="Hapus pertanyaan">
                            ✕
                          </button>
                        </div>

                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, marginLeft: 26 }}>
                          <span style={{ fontSize: 12, color: COLORS.muted }}>Skor:</span>
                          <select
                            className="aa-select"
                            style={{ width: "auto", background: "#fff", padding: "6px 10px", fontSize: 12 }}
                            value={q.scoreMode}
                            onChange={(e) => updateDraftQuestion(i, { scoreMode: e.target.value })}
                          >
                            <option value="normal">Normal (sesuai pilihan)</option>
                            <option value="manual">Manual (atur sendiri)</option>
                          </select>
                        </div>

                        {q.scoreMode === "manual" && (
                          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10, marginLeft: 26 }}>
                            {Array.from({ length: draft.scaleMax || 5 }, (_, idx) => idx + 1).map((v) => (
                              <div key={v} className="aa-score-box">
                                <span style={{ fontSize: 11, color: COLORS.muted }}>pilih {v}</span>
                                <input
                                  type="number"
                                  value={
                                    q.manualScores && q.manualScores[v] !== undefined && q.manualScores[v] !== ""
                                      ? q.manualScores[v]
                                      : v
                                  }
                                  onChange={(e) => updateManualScore(i, v, e.target.value)}
                                />
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", background: COLORS.paper, borderRadius: 8 }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>Status Asesmen</div>
                    <div style={{ fontSize: 12, color: COLORS.muted }}>
                      {draft.closed ? "Ditutup — audiens tidak bisa mengisi" : "Terbuka — audiens bisa mengisi"}
                    </div>
                  </div>
                  <button
                    className="aa-btn"
                    style={{
                      padding: "8px 14px",
                      borderRadius: 8,
                      fontWeight: 600,
                      fontSize: 13,
                      background: draft.closed ? COLORS.teal : COLORS.danger,
                      color: "#fff",
                    }}
                    onClick={() => setDraft({ ...draft, closed: !draft.closed })}
                  >
                    {draft.closed ? "Buka Asesmen" : "Tutup Asesmen"}
                  </button>
                </div>

                <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 4 }}>
                  <button className="aa-btn aa-primary" style={{ padding: "10px 18px", borderRadius: 8, fontWeight: 600 }} onClick={saveConfig}>
                    Simpan Perubahan
                  </button>
                  {saveMsg && <span style={{ fontSize: 13, color: COLORS.muted }}>{saveMsg}</span>}
                </div>
              </div>
            )}

            {adminTab === "fields" && (
              <div style={{ display: "grid", gap: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ fontSize: 13, color: COLORS.muted }}>
                    Kolom yang wajib/opsional diisi audiens sebelum menjawab pertanyaan.
                  </div>
                  <button
                    className="aa-btn"
                    style={{ fontSize: 12, fontWeight: 600, color: COLORS.teal, background: "transparent", whiteSpace: "nowrap" }}
                    onClick={addField}
                  >
                    + Tambah Kolom
                  </button>
                </div>

                <div style={{ display: "grid", gap: 10 }}>
                  {draft.fields.map((f, i) => (
                    <div
                      key={f.id}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "1fr 110px auto auto",
                        gap: 8,
                        alignItems: "center",
                        padding: 10,
                        background: COLORS.paper,
                        borderRadius: 8,
                      }}
                    >
                      <input
                        className="aa-input"
                        value={f.label}
                        onChange={(e) => updateDraftField(i, { label: e.target.value })}
                        placeholder="Label kolom, mis. Nomor HP"
                      />
                      <select className="aa-select" value={f.type} onChange={(e) => updateDraftField(i, { type: e.target.value })}>
                        {FIELD_TYPES.map((t) => (
                          <option key={t.value} value={t.value}>
                            {t.label}
                          </option>
                        ))}
                      </select>
                      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: COLORS.muted, whiteSpace: "nowrap" }}>
                        <input type="checkbox" checked={f.required} onChange={(e) => updateDraftField(i, { required: e.target.checked })} />
                        Wajib
                      </label>
                      <button className="aa-icon-btn" onClick={() => removeField(i)} title="Hapus kolom">
                        ✕
                      </button>
                    </div>
                  ))}
                </div>

                <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 4 }}>
                  <button className="aa-btn aa-primary" style={{ padding: "10px 18px", borderRadius: 8, fontWeight: 600 }} onClick={saveConfig}>
                    Simpan Perubahan
                  </button>
                  {saveMsg && <span style={{ fontSize: 13, color: COLORS.muted }}>{saveMsg}</span>}
                </div>
              </div>
            )}

            {adminTab === "results" && (
              <div>
                <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
                  <button className="aa-btn aa-ghost" style={{ border: `1px solid ${COLORS.line}`, borderRadius: 8, padding: "9px 14px", fontSize: 13 }} onClick={() => loadResponses(editingId)}>
                    {loadingResponses ? "Memuat…" : "Muat Ulang"}
                  </button>
                  <button
                    className="aa-btn aa-primary"
                    style={{ padding: "9px 14px", borderRadius: 8, fontSize: 13, fontWeight: 600 }}
                    onClick={exportExcel}
                    disabled={responses.length === 0}
                  >
                    Download Excel ({responses.length})
                  </button>
                  <button
                    className="aa-btn"
                    style={{ padding: "9px 14px", borderRadius: 8, fontSize: 13, background: "transparent", color: COLORS.danger, border: `1px solid ${COLORS.danger}` }}
                    onClick={clearResponses}
                    disabled={responses.length === 0}
                  >
                    Hapus Semua Data
                  </button>
                </div>

                {responses.length === 0 ? (
                  <div style={{ fontSize: 13, color: COLORS.muted, padding: "20px 0" }}>Belum ada jawaban masuk.</div>
                ) : (
                  <div style={{ overflowX: "auto" }}>
                    <table className="aa-table">
                      <thead>
                        <tr>
                          {editConfig.fields.map((f) => (
                            <th key={f.id}>{f.label}</th>
                          ))}
                          <th>Total</th>
                          <th>Waktu</th>
                        </tr>
                      </thead>
                      <tbody>
                        {responses.map((r) => (
                          <tr key={r.key}>
                            {editConfig.fields.map((f) => (
                              <td key={f.id}>{(r.values || {})[f.id] || "-"}</td>
                            ))}
                            <td style={{ fontWeight: 700, color: COLORS.teal }}>{r.total}</td>
                            <td>{new Date(r.timestamp).toLocaleString("id-ID")}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {(view === "form" || view === "thankyou" || view === "closed" || view === "not-found") && (
        <div style={{ maxWidth: 640, margin: "16px auto 0", textAlign: "center" }}>
          <button className="aa-btn aa-ghost" style={{ fontSize: 12, textDecoration: "underline" }} onClick={openAdminGate}>
            Masuk sebagai admin
          </button>
        </div>
      )}
    </div>
  );
}
