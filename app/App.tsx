import React, { useEffect, useState, useCallback } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, StatusBar, SafeAreaView,
} from "react-native";
import {
  init, shutdown, getState, subscribe,
  createForm, submitResponse, closeForm,
} from "../src/app-state";
import { AppState, CreatorView, FormDef, Question } from "../src/engine";

// ── Design tokens ─────────────────────────────────────────────────────────────
const C = {
  primary: "#7c6ff7",
  primarySubtle: "#1e1b3a",
  accent: "#f7a44c",
  bg: "#0b0b10",
  surface: "#14141e",
  surfaceRaised: "#1c1c2a",
  border: "#2a2a3e",
  borderSubtle: "#1e1e30",
  text: "#f0f0f8",
  textSec: "#a0a0b8",
  textTert: "#6b6b82",
  success: "#4ade80",
  warning: "#fbbf24",
  error: "#f87171",
};

const R = { sm: 8, md: 12, lg: 16, xl: 24 };

// ── Main App ──────────────────────────────────────────────────────────────────

export default function App() {
  const [, setTick] = useState(0);
  const [selectedId, setSelectedId] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const [answers, setAnswers] = useState<Record<string, string>>({});

  useEffect(() => {
    init().catch((e) => console.error("init failed:", e));
    const unsub = subscribe(() => setTick((n) => n + 1));
    return () => { unsub(); shutdown(); };
  }, []);

  const { state, creatorView, status, identity } = getState();

  const selectedForm = state?.forms[selectedId] || null;
  const isCreator = !!(creatorView && selectedForm && creatorView.forms.includes(selectedForm.id));
  const responses = creatorView?.responses[selectedId] || [];

  const handleCreate = async (title: string, questions: Question[]) => {
    try {
      const fid = await createForm(title, "", questions);
      setSelectedId(fid);
      setShowCreate(false);
    } catch (e: any) {
      alert("Create failed: " + e.message);
    }
  };

  const handleSubmit = async () => {
    if (!selectedForm) return;
    const ans = selectedForm.questions
      .filter((q) => answers[q.id])
      .map((q) => ({ question: q.text, answer: answers[q.id] }));
    if (ans.length === 0) { alert("Answer at least one question"); return; }
    try {
      await submitResponse(selectedForm.id, ans);
      setAnswers({});
      alert("Response submitted ✓");
    } catch (e: any) {
      alert("Submit failed: " + e.message);
    }
  };

  const shareUri = selectedForm
    ? `whisperbox://form?id=${selectedForm.id}`
    : "";

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />
      <View style={styles.row}>
        {/* ── Sidebar ── */}
        <View style={styles.sidebar}>
          <View style={styles.brand}>
            <Text style={styles.brandIcon}>🔒</Text>
            <View>
              <Text style={styles.brandName}>WhisperBox</Text>
              <Text style={styles.brandSub}>encrypted forms</Text>
            </View>
          </View>

          <TouchableOpacity style={styles.newBtn} onPress={() => setShowCreate(true)}>
            <Text style={styles.newBtnText}>+ New Form</Text>
          </TouchableOpacity>

          <Text style={styles.sectionLabel}>FORMS</Text>

          <ScrollView style={styles.formList}>
            {(state?.feed || []).map((fid) => {
              const f = state!.forms[fid];
              const active = fid === selectedId;
              const mine = creatorView?.forms.includes(fid);
              const respCount = creatorView?.responses[fid]?.length || 0;
              return (
                <TouchableOpacity
                  key={fid}
                  style={[styles.formItem, active && styles.formItemActive]}
                  onPress={() => { setSelectedId(fid); setAnswers({}); }}
                >
                  <View style={styles.formIcon}>
                    <Text>📋</Text>
                  </View>
                  <View style={styles.formBody}>
                    <Text style={styles.formTitle} numberOfLines={1}>
                      {f?.title || fid}
                    </Text>
                    <Text style={styles.formMeta}>
                      {(f?.questions?.length || 0) + "q"}
                      {respCount > 0 && ` · ${respCount} resp`}
                    </Text>
                  </View>
                  {mine && (
                    <View style={styles.mineBadge}>
                      <Text style={styles.mineBadgeText}>Mine</Text>
                    </View>
                  )}
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          <View style={styles.footer}>
            <View style={[styles.dot, { backgroundColor: state?.nodeReady ? C.success : C.warning }]} />
            <Text style={styles.footerText}>
              {status} · {identity ? identity.address.slice(0, 8) + "…" : "—"}
            </Text>
          </View>
        </View>

        {/* ── Main Pane ── */}
        <View style={styles.main}>
          {!selectedForm ? (
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>Select a form</Text>
              <Text style={styles.emptySub}>Choose a form from the sidebar, or create a new one.</Text>
            </View>
          ) : (
            <ScrollView contentContainerStyle={styles.detail}>
              {/* Header */}
              <View style={styles.detailHeader}>
                <Text style={styles.detailTitle}>{selectedForm.title}</Text>
                {isCreator && (
                  <TouchableOpacity
                    style={styles.shareBtn}
                    onPress={() => setShowShare(true)}
                  >
                    <Text style={styles.shareBtnText}>Share</Text>
                  </TouchableOpacity>
                )}
              </View>

              {selectedForm.description ? (
                <Text style={styles.detailDesc}>{selectedForm.description}</Text>
              ) : null}

              <View style={styles.metaRow}>
                {selectedForm.status !== "closed" && (
                  <View style={styles.openBadge}>
                    <Text style={styles.openBadgeText}>Open</Text>
                  </View>
                )}
                <Text style={styles.metaText}>
                  by {selectedForm.creator.slice(0, 6)}…{selectedForm.creator.slice(-4)}
                </Text>
              </View>

              {/* ── Creator View ── */}
              {isCreator && (
                <View>
                  {/* Stats */}
                  <View style={styles.statsRow}>
                    <View style={styles.statCard}>
                      <Text style={[styles.statNum, { color: C.primary }]}>{responses.length}</Text>
                      <Text style={styles.statLabel}>Responses</Text>
                    </View>
                    <View style={styles.statCard}>
                      <Text style={styles.statNum}>
                        {responses.filter((r) => r.confirmed).length}
                      </Text>
                      <Text style={styles.statLabel}>Confirmed</Text>
                    </View>
                    <View style={styles.statCard}>
                      <Text style={[styles.statNum, { color: C.success }]}>
                        {responses.length > 0
                          ? Math.round((responses.length - (creatorView?.undecrypted || 0)) / responses.length * 100) + "%"
                          : "—"}
                      </Text>
                      <Text style={styles.statLabel}>Decrypted</Text>
                    </View>
                  </View>

                  {/* Share card */}
                  <View style={styles.shareCard}>
                    <Text style={styles.shareCardLabel}>SHARE THIS FORM</Text>
                    <View style={styles.shareUriBox}>
                      <Text style={styles.shareUriText} numberOfLines={1}>{shareUri}</Text>
                    </View>
                  </View>

                  {/* Responses */}
                  <Text style={styles.sectionLabel}>
                    RESPONSES ({responses.length})
                  </Text>
                  {responses.map((r, i) => (
                    <View key={i} style={styles.respCard}>
                      <View style={styles.respHeader}>
                        <Text style={styles.respAddr}>
                          {r.respondent.slice(0, 6)}…{r.respondent.slice(-4)}
                        </Text>
                        {r.confirmed ? (
                          <View style={styles.confirmedBadge}>
                            <Text style={styles.confirmedBadgeText}>✓ Confirmed</Text>
                          </View>
                        ) : (
                          <View style={styles.decryptedBadge}>
                            <Text style={styles.decryptedBadgeText}>Decrypted</Text>
                          </View>
                        )}
                      </View>
                      {r.answers.map((a, j) => (
                        <View key={j} style={styles.respRow}>
                          <Text style={styles.respQ} numberOfLines={1}>{a.question}</Text>
                          <Text style={styles.respA}>{a.answer}</Text>
                        </View>
                      ))}
                    </View>
                  ))}
                </View>
              )}

              {/* ── Respondent View ── */}
              {!isCreator && selectedForm.questions && (
                <View>
                  {selectedForm.questions.map((q) => (
                    <View key={q.id} style={styles.questionBlock}>
                      <Text style={styles.questionText}>
                        {q.text}{q.required ? " *" : ""}
                      </Text>
                      <TextInput
                        style={styles.input}
                        placeholder="Your answer"
                        placeholderTextColor={C.textTert}
                        value={answers[q.id] || ""}
                        onChangeText={(t) => setAnswers((a) => ({ ...a, [q.id]: t }))}
                      />
                    </View>
                  ))}

                  <TouchableOpacity style={styles.submitBtn} onPress={handleSubmit}>
                    <Text style={styles.submitBtnText}>Submit Response</Text>
                  </TouchableOpacity>

                  <View style={styles.privacyNote}>
                    <Text style={styles.privacyNoteText}>
                      🔒 Your answers are sealed end-to-end. Only the form creator can read them.
                    </Text>
                  </View>
                </View>
              )}
            </ScrollView>
          )}
        </View>
      </View>

      {/* ── Create Overlay ── */}
      {showCreate && (
        <CreateOverlay
          onClose={() => setShowCreate(false)}
          onCreate={handleCreate}
        />
      )}

      {/* ── Share Overlay ── */}
      {showShare && (
        <View style={styles.overlay}>
          <View style={styles.overlayCard}>
            <View style={styles.overlayHeader}>
              <Text style={styles.overlayTitle}>Share Form</Text>
              <TouchableOpacity onPress={() => setShowShare(false)}>
                <Text style={styles.overlayClose}>✕</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.shareCardLabel}>SHARE THIS FORM</Text>
            <View style={styles.shareUriBox}>
              <Text style={styles.shareUriText} numberOfLines={2}>{shareUri}</Text>
            </View>
            <Text style={styles.sharePrivacy}>
              Anyone with this link can respond. Responses are encrypted end-to-end.
            </Text>
            <TouchableOpacity
              style={[styles.newBtn, { marginTop: 16 }]}
              onPress={() => setShowShare(false)}
            >
              <Text style={styles.newBtnText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

// ── Create Form Overlay ───────────────────────────────────────────────────────

function CreateOverlay({ onClose, onCreate }: {
  onClose: () => void;
  onCreate: (title: string, questions: Question[]) => void;
}) {
  const [title, setTitle] = useState("");
  const [questions, setQuestions] = useState<Question[]>([]);
  const [qText, setQText] = useState("");

  const addQuestion = () => {
    if (!qText.trim()) return;
    setQuestions((qs) => [
      ...qs,
      { id: "question_" + (qs.length + 1), type: "text", text: qText.trim(), required: true },
    ]);
    setQText("");
  };

  const doCreate = () => {
    if (!title.trim()) { alert("Form needs a title"); return; }
    if (questions.length === 0) { alert("Add at least one question"); return; }
    onCreate(title.trim(), questions);
  };

  return (
    <View style={styles.overlay}>
      <View style={[styles.overlayCard, { maxHeight: "80%" }]}>
        <View style={styles.overlayHeader}>
          <Text style={styles.overlayTitle}>New Form</Text>
          <TouchableOpacity onPress={onClose}>
            <Text style={styles.overlayClose}>✕</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.sectionLabel}>TITLE</Text>
        <TextInput
          style={styles.input}
          placeholder="Form title"
          placeholderTextColor={C.textTert}
          value={title}
          onChangeText={setTitle}
        />

        <Text style={styles.sectionLabel}>QUESTIONS ({questions.length})</Text>
        {questions.map((q, i) => (
          <View key={i} style={styles.draftQ}>
            <Text style={styles.draftQNum}>Q{i + 1}</Text>
            <Text style={styles.draftQText} numberOfLines={1}>{q.text}</Text>
            <TouchableOpacity onPress={() => setQuestions((qs) => qs.filter((_, j) => j !== i))}>
              <Text style={styles.draftQRemove}>✕</Text>
            </TouchableOpacity>
          </View>
        ))}

        <View style={styles.addQRow}>
          <TextInput
            style={[styles.input, { flex: 1 }]}
            placeholder="Question text"
            placeholderTextColor={C.textTert}
            value={qText}
            onChangeText={setQText}
            onSubmitEditing={addQuestion}
          />
          <TouchableOpacity style={styles.addQBtn} onPress={addQuestion}>
            <Text style={styles.addQBtnText}>+</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.overlayFooter}>
          <TouchableOpacity onPress={onClose}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.newBtn} onPress={doCreate}>
            <Text style={styles.newBtnText}>Create</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  row: { flex: 1, flexDirection: "row" },

  // Sidebar
  sidebar: {
    width: "42%", backgroundColor: C.bg,
    borderRightWidth: 1, borderRightColor: C.borderSubtle,
    paddingHorizontal: 16, paddingTop: 16, paddingBottom: 12,
  },
  brand: { flexDirection: "row", alignItems: "center", marginBottom: 16 },
  brandIcon: { fontSize: 20, marginRight: 8 },
  brandName: { fontSize: 16, fontWeight: "700", color: C.text },
  brandSub: { fontSize: 11, color: C.textTert },

  newBtn: {
    backgroundColor: C.primary, borderRadius: R.md,
    paddingVertical: 10, alignItems: "center", marginBottom: 16,
  },
  newBtnText: { color: "#fff", fontSize: 13, fontWeight: "600" },

  sectionLabel: {
    fontSize: 10, fontWeight: "600", color: C.textTert,
    marginBottom: 8, marginTop: 4,
  },

  formList: { flex: 1 },
  formItem: {
    flexDirection: "row", alignItems: "center",
    padding: 10, borderRadius: R.md, marginBottom: 4,
    borderWidth: 1, borderColor: "transparent",
  },
  formItemActive: { backgroundColor: C.primarySubtle, borderColor: C.primary },
  formIcon: {
    width: 32, height: 32, borderRadius: R.sm,
    backgroundColor: C.primarySubtle,
    alignItems: "center", justifyContent: "center", marginRight: 8,
  },
  formBody: { flex: 1 },
  formTitle: { fontSize: 13, fontWeight: "600", color: C.text },
  formMeta: { fontSize: 11, color: C.textTert },
  mineBadge: {
    backgroundColor: C.primarySubtle, borderRadius: 10,
    paddingHorizontal: 7, paddingVertical: 2,
  },
  mineBadgeText: { fontSize: 10, fontWeight: "600", color: C.primary },

  footer: {
    flexDirection: "row", alignItems: "center",
    paddingTop: 8, borderTopWidth: 1, borderTopColor: C.borderSubtle,
  },
  dot: { width: 7, height: 7, borderRadius: 4, marginRight: 6 },
  footerText: { fontSize: 11, color: C.textTert },

  // Main pane
  main: { flex: 1, backgroundColor: C.surface },
  empty: { flex: 1, alignItems: "center", justifyContent: "center" },
  emptyTitle: { fontSize: 18, fontWeight: "600", color: C.textSec, marginBottom: 4 },
  emptySub: { fontSize: 13, color: C.textTert },

  detail: { padding: 20 },
  detailHeader: { flexDirection: "row", alignItems: "flex-start", marginBottom: 8 },
  detailTitle: { flex: 1, fontSize: 22, fontWeight: "700", color: C.text },
  shareBtn: {
    backgroundColor: C.surfaceRaised, borderRadius: R.md,
    paddingHorizontal: 12, paddingVertical: 6,
    borderWidth: 1, borderColor: C.border,
  },
  shareBtnText: { fontSize: 12, fontWeight: "600", color: C.text },
  detailDesc: { fontSize: 13, color: C.textSec, marginBottom: 8 },
  metaRow: { flexDirection: "row", alignItems: "center", marginBottom: 16 },
  openBadge: {
    backgroundColor: "#1a3d2a", borderRadius: 10,
    paddingHorizontal: 8, paddingVertical: 2, marginRight: 8,
  },
  openBadgeText: { fontSize: 10, fontWeight: "600", color: C.success },
  metaText: { fontSize: 12, color: C.textTert },

  // Stats
  statsRow: { flexDirection: "row", gap: 8, marginBottom: 16 },
  statCard: {
    flex: 1, backgroundColor: C.surfaceRaised, borderRadius: R.md,
    paddingVertical: 12, alignItems: "center",
  },
  statNum: { fontSize: 24, fontWeight: "700", color: C.text },
  statLabel: { fontSize: 11, color: C.textTert, marginTop: 2 },

  // Share card
  shareCard: {
    backgroundColor: C.surfaceRaised, borderRadius: R.md,
    padding: 14, marginBottom: 16,
    borderWidth: 1, borderColor: C.borderSubtle,
  },
  shareCardLabel: { fontSize: 10, fontWeight: "600", color: C.textTert, marginBottom: 8 },
  shareUriBox: {
    backgroundColor: C.bg, borderRadius: R.sm,
    paddingHorizontal: 10, paddingVertical: 8,
    borderWidth: 1, borderColor: C.border,
  },
  shareUriText: { fontSize: 11, fontFamily: "monospace", color: C.textSec },
  sharePrivacy: { fontSize: 12, color: C.textTert, marginTop: 10 },

  // Responses
  respCard: {
    backgroundColor: C.surfaceRaised, borderRadius: R.md,
    padding: 14, marginBottom: 8,
    borderWidth: 1, borderColor: C.borderSubtle,
  },
  respHeader: { flexDirection: "row", justifyContent: "space-between", marginBottom: 8 },
  respAddr: { fontSize: 11, fontFamily: "monospace", color: C.textSec },
  confirmedBadge: { backgroundColor: "#1a3d2a", borderRadius: 9, paddingHorizontal: 6, paddingVertical: 2 },
  confirmedBadgeText: { fontSize: 9, fontWeight: "600", color: C.success },
  decryptedBadge: { backgroundColor: "#1a3d2a", borderRadius: 9, paddingHorizontal: 6, paddingVertical: 2 },
  decryptedBadgeText: { fontSize: 9, fontWeight: "600", color: C.success },
  respRow: { flexDirection: "row", marginBottom: 4 },
  respQ: { width: "40%", fontSize: 12, color: C.textTert },
  respA: { flex: 1, fontSize: 13, color: C.text },

  // Questions (respondent)
  questionBlock: { marginBottom: 12 },
  questionText: { fontSize: 14, fontWeight: "600", color: C.text, marginBottom: 6 },
  input: {
    backgroundColor: C.surfaceRaised, borderRadius: R.md,
    paddingHorizontal: 14, paddingVertical: 12,
    color: C.text, fontSize: 13,
    borderWidth: 1, borderColor: C.border,
  },
  submitBtn: {
    backgroundColor: C.accent, borderRadius: R.md,
    paddingVertical: 14, alignItems: "center", marginTop: 8,
  },
  submitBtnText: { fontSize: 15, fontWeight: "700", color: C.bg },
  privacyNote: {
    backgroundColor: "#1a2a1a", borderRadius: R.md,
    padding: 14, marginTop: 12,
    borderWidth: 1, borderColor: "#2a4d3a",
  },
  privacyNoteText: { fontSize: 12, color: C.success },

  // Overlays
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(11,11,16,0.8)",
    justifyContent: "center", alignItems: "center",
    padding: 24, zIndex: 100,
  },
  overlayCard: {
    backgroundColor: C.surface, borderRadius: R.lg,
    padding: 20, width: "100%",
    borderWidth: 1, borderColor: C.border,
  },
  overlayHeader: { flexDirection: "row", justifyContent: "space-between", marginBottom: 16 },
  overlayTitle: { fontSize: 20, fontWeight: "700", color: C.text },
  overlayClose: { fontSize: 14, color: C.textTert },
  overlayFooter: { flexDirection: "row", justifyContent: "flex-end", gap: 12, marginTop: 16 },
  cancelText: { fontSize: 14, color: C.textTert, alignSelf: "center" },

  // Draft questions
  draftQ: {
    flexDirection: "row", alignItems: "center",
    backgroundColor: C.surfaceRaised, borderRadius: R.sm,
    paddingHorizontal: 10, paddingVertical: 8, marginBottom: 4,
    borderWidth: 1, borderColor: C.border,
  },
  draftQNum: { fontSize: 12, fontWeight: "600", color: C.primary, marginRight: 8 },
  draftQText: { flex: 1, fontSize: 13, color: C.text },
  draftQRemove: { fontSize: 12, color: C.textTert, padding: 4 },
  addQRow: { flexDirection: "row", gap: 8, marginTop: 8 },
  addQBtn: {
    width: 44, backgroundColor: C.surfaceRaised, borderRadius: R.md,
    alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderColor: C.border,
  },
  addQBtnText: { fontSize: 18, color: C.textTert },
});
