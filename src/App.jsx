import { useState, useEffect } from "react";
import * as XLSX from "xlsx";
import { storage } from "./lib/storage";

function genId(prefix) {
  return prefix + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

const DEFAULT_QUESTIONS = [
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

const DEFAULT_CONFIG = {
  title: "Asesmen Kesiapan Presentasi Virtual",
  subtitle: "Jawab sesuai kondisi Anda saat ini. Tidak ada jawaban salah.",
  minLabel: "Sangat Tidak Setuju",
  maxLabel: "Sangat Setuju",
  fields: DEFAULT_FIELDS,
  questions: DEFAULT_QUESTIONS,
  adminCode: "1234",
  closed: false,
};

const CONFIG_KEY = "assessment-config";
const RESP_PREFIX = "resp:";

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
  const [config, setConfig] = useState(null);
  const [view, setView] = useState("loading");

  const [formValues, setFormValues] = useState({});
  const [answers, setAnswers] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [lastTotal, setLastTotal] = useState(null);
  const [formErr, setFormErr] = useState("");

  const [adminCodeInput, setAdminCodeInput] = useState("");
  const [adminErr, setAdminErr] = useState("");
  const [draft, setDraft] = useState(null);
  const [adminTab, setAdminTab] = useState("settings");
  const [responses, setResponses] = useState([]);
  const [loadingResponses, setLoadingResponses] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      let parsed = DEFAULT_CONFIG;
      try {
        const res = await storage.get(CONFIG_KEY, true);
        if (res && res.value) parsed = JSON.parse(res.value);
      } catch (e) {
        parsed = DEFAULT_CONFIG;
      }
      if (!cancelled) {
        setConfig(parsed);
        setView(parsed.closed ? "closed" : "form");
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  function handleFieldChange(fieldId, val) {
    setFormValues((prev) => ({ ...prev, [fieldId]: val }));
    setFormErr("");
  }

  function handleSelect(qIdx, val) {
    setAnswers((prev) => ({ ...prev, [qIdx]: val }));
    setFormErr("");
  }

  const answeredCount = Object.keys(answers).length;
  const totalQuestions = config ? config.questions.length : 0;

  async function handleSubmit() {
    for (const f of config.fields) {
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
    const total = Object.values(answers).reduce((a, b) => a + b, 0);
    const id = RESP_PREFIX + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
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

  function checkAdminCode() {
    if (adminCodeInput === config.adminCode) {
      setDraft({
        ...config,
        fields: config.fields.map((f) => ({ ...f })),
        questions: [...config.questions],
      });
      setAdminErr("");
      setAdminTab("settings");
      setView("admin");
      loadResponses();
    } else {
      setAdminErr("Kode akses salah.");
    }
  }

  async function loadResponses() {
    setLoadingResponses(true);
    try {
      const listRes = await storage.list(RESP_PREFIX, true);
      const keys = listRes && listRes.keys ? listRes.keys : [];
      const items = [];
      for (const k of keys) {
        try {
          const r = await storage.get(k, true);
          if (r && r.value) items.push({ key: k, ...JSON.parse(r.value) });
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
    const cleanQ = draft.questions.filter((q) => q.trim());
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
    const cleaned = { ...draft, questions: draft.questions.filter((q) => q.trim()) };
    try {
      const res = await storage.set(CONFIG_KEY, JSON.stringify(cleaned), true);
      if (res) {
        setConfig(cleaned);
        setDraft({ ...cleaned, fields: cleaned.fields.map((f) => ({ ...f })), questions: [...cleaned.questions] });
        setSaveMsg("Perubahan tersimpan.");
      } else {
        setSaveMsg("Gagal menyimpan perubahan.");
      }
    } catch (e) {
      setSaveMsg("Gagal menyimpan perubahan.");
    }
  }

  function updateDraftQuestion(i, text) {
    setDraft((prev) => {
      const qs = [...prev.questions];
      qs[i] = text;
      return { ...prev, questions: qs };
    });
  }

  function addQuestion() {
    setDraft((prev) => ({ ...prev, questions: [...prev.questions, ""] }));
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
    const rows = responses.map((r, i) => {
      const row = { No: i + 1 };
      config.fields.forEach((f) => {
        row[f.label] = (r.values || {})[f.id] || "";
      });
      config.questions.forEach((q, qi) => {
        row["Q" + (qi + 1)] = r.answers[qi];
      });
      row["Total Poin"] = r.total;
      row["Waktu"] = new Date(r.timestamp).toLocaleString("id-ID");
      return row;
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Hasil Asesmen");
    XLSX.writeFile(wb, "hasil-asesmen-" + Date.now() + ".xlsx");
  }

  async function clearResponses() {
    if (!window.confirm("Hapus semua data hasil asesmen? Tindakan ini tidak bisa dibatalkan.")) return;
    try {
      for (const r of responses) {
        await storage.delete(r.key, true);
      }
      setResponses([]);
      setSaveMsg("Semua data hasil telah dihapus.");
    } catch (e) {
      setSaveMsg("Sebagian data gagal dihapus.");
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

  if (view === "loading" || !config) {
    return (
      <div style={{ ...wrap, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ color: COLORS.muted, fontFamily: FONT_STACK.body }}>Memuat asesmen…</div>
      </div>
    );
  }

  return (
    <div style={wrap}>
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
        .aa-scale-row { display: flex; gap: 8px; flex-wrap: wrap; }
        .aa-scale-btn { width: 44px; height: 44px; border-radius: 50%; border: 1.5px solid ${COLORS.line}; background: #fff; font-family: ${FONT_STACK.display}; font-weight: 600; font-size: 15px; color: ${COLORS.ink}; cursor: pointer; transition: all .15s ease; }
        .aa-scale-btn:hover { border-color: ${COLORS.teal}; }
        .aa-scale-btn.selected { background: ${COLORS.teal}; border-color: ${COLORS.teal}; color: #fff; }
        .aa-icon-btn { width: 30px; height: 30px; border-radius: 6px; border: 1px solid ${COLORS.line}; background: #fff; color: ${COLORS.danger}; font-size: 15px; line-height: 1; cursor: pointer; flex-shrink: 0; }
        .aa-icon-btn:hover { background: #FBEAE4; }
        table.aa-table { width: 100%; border-collapse: collapse; font-size: 13px; }
        table.aa-table th, table.aa-table td { text-align: left; padding: 8px 10px; border-bottom: 1px solid ${COLORS.line}; white-space: nowrap; }
        table.aa-table th { color: ${COLORS.muted}; font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: .03em; }
        @media (max-width: 480px) {
          .aa-scale-btn { width: 38px; height: 38px; font-size: 13px; }
        }
      `}</style>

      {/* ================= FORM VIEW ================= */}
      {view === "form" && (
        <div style={card}>
          <div style={spotlightBar} />
          <div style={{ padding: "28px 28px 24px" }}>
            <h1 style={{ fontFamily: FONT_STACK.display, fontSize: 22, fontWeight: 700, margin: "0 0 6px" }}>
              {config.title}
            </h1>
            <p style={{ color: COLORS.muted, fontSize: 14, margin: "0 0 24px", lineHeight: 1.5 }}>
              {config.subtitle}
            </p>

            <div style={{ display: "grid", gap: 14, marginBottom: 24 }}>
              {config.fields.map((f) => (
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

            <div
              style={{
                height: 6,
                borderRadius: 3,
                background: COLORS.line,
                overflow: "hidden",
                marginBottom: 6,
              }}
            >
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
              {config.questions.map((q, i) => (
                <div key={i}>
                  <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 10, lineHeight: 1.5 }}>
                    {i + 1}. {q}
                  </div>
                  <div className="aa-scale-row">
                    {[1, 2, 3, 4, 5].map((val) => (
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
                    <span>{config.minLabel}</span>
                    <span>{config.maxLabel}</span>
                  </div>
                </div>
              ))}
            </div>

            {formErr && (
              <div style={{ color: COLORS.danger, fontSize: 13, marginTop: 18 }}>{formErr}</div>
            )}

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
            <div style={{ fontSize: 13, color: COLORS.muted }}>
              dari maksimal {totalQuestions * 5} poin
            </div>
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
              onKeyDown={(e) => e.key === "Enter" && checkAdminCode()}
            />
            {adminErr && <div style={{ color: COLORS.danger, fontSize: 13, marginTop: 8 }}>{adminErr}</div>}
            <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
              <button className="aa-btn aa-primary" style={{ flex: 1, padding: "10px", borderRadius: 8, fontWeight: 600 }} onClick={checkAdminCode}>
                Masuk
              </button>
              <button className="aa-btn aa-ghost" style={{ padding: "10px" }} onClick={() => setView(config.closed ? "closed" : "form")}>
                Batal
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ================= ADMIN PANEL ================= */}
      {view === "admin" && draft && (
        <div style={{ ...card, maxWidth: 760 }}>
          <div style={spotlightBar} />
          <div style={{ padding: "24px 28px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
              <div style={{ fontFamily: FONT_STACK.display, fontSize: 18, fontWeight: 700 }}>Panel Admin</div>
              <button className="aa-btn aa-ghost" style={{ fontSize: 13 }} onClick={() => setView(config.closed ? "closed" : "form")}>
                Keluar
              </button>
            </div>

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
                  <label style={{ fontSize: 13, fontWeight: 600, marginBottom: 6, display: "block" }}>Subjudul / Keterangan</label>
                  <input className="aa-input" value={draft.subtitle} onChange={(e) => setDraft({ ...draft, subtitle: e.target.value })} />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div>
                    <label style={{ fontSize: 13, fontWeight: 600, marginBottom: 6, display: "block" }}>Label Skala Terendah (1)</label>
                    <input className="aa-input" value={draft.minLabel} onChange={(e) => setDraft({ ...draft, minLabel: e.target.value })} />
                  </div>
                  <div>
                    <label style={{ fontSize: 13, fontWeight: 600, marginBottom: 6, display: "block" }}>Label Skala Tertinggi (5)</label>
                    <input className="aa-input" value={draft.maxLabel} onChange={(e) => setDraft({ ...draft, maxLabel: e.target.value })} />
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
                  <div style={{ display: "grid", gap: 8 }}>
                    {draft.questions.map((q, i) => (
                      <div key={i} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <span style={{ fontSize: 12, color: COLORS.muted, width: 18 }}>{i + 1}.</span>
                        <input className="aa-input" value={q} onChange={(e) => updateDraftQuestion(i, e.target.value)} />
                        <button className="aa-icon-btn" onClick={() => removeQuestion(i)} title="Hapus pertanyaan">
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <label style={{ fontSize: 13, fontWeight: 600, marginBottom: 6, display: "block" }}>Kode Akses Admin</label>
                  <input className="aa-input" value={draft.adminCode} onChange={(e) => setDraft({ ...draft, adminCode: e.target.value })} />
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
                      <select
                        className="aa-select"
                        value={f.type}
                        onChange={(e) => updateDraftField(i, { type: e.target.value })}
                      >
                        {FIELD_TYPES.map((t) => (
                          <option key={t.value} value={t.value}>
                            {t.label}
                          </option>
                        ))}
                      </select>
                      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: COLORS.muted, whiteSpace: "nowrap" }}>
                        <input
                          type="checkbox"
                          checked={f.required}
                          onChange={(e) => updateDraftField(i, { required: e.target.checked })}
                        />
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
                  <button className="aa-btn aa-ghost" style={{ border: `1px solid ${COLORS.line}`, borderRadius: 8, padding: "9px 14px", fontSize: 13 }} onClick={loadResponses}>
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
                  <div style={{ fontSize: 13, color: COLORS.muted, padding: "20px 0" }}>
                    Belum ada jawaban masuk.
                  </div>
                ) : (
                  <div style={{ overflowX: "auto" }}>
                    <table className="aa-table">
                      <thead>
                        <tr>
                          {config.fields.map((f) => (
                            <th key={f.id}>{f.label}</th>
                          ))}
                          <th>Total</th>
                          <th>Waktu</th>
                        </tr>
                      </thead>
                      <tbody>
                        {responses.map((r) => (
                          <tr key={r.key}>
                            {config.fields.map((f) => (
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

      {(view === "form" || view === "thankyou" || view === "closed") && (
        <div style={{ maxWidth: 640, margin: "16px auto 0", textAlign: "center" }}>
          <button className="aa-btn aa-ghost" style={{ fontSize: 12, textDecoration: "underline" }} onClick={openAdminGate}>
            Masuk sebagai admin
          </button>
        </div>
      )}
    </div>
  );
}
