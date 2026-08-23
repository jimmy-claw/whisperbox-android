import React, { useEffect, useState, useCallback } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, StatusBar, SafeAreaView, Alert,
} from "react-native";
import {
  init, shutdown, getState, subscribe,
  createForm, submitResponse, closeForm,
  getSavedNodeMode, saveNodeMode, switchNodeMode,
  NodeMode,
} from "./src/app-state";
import { AppState, CreatorView, FormDef, Question } from "./src/engine";

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
  const [showSidebar, setShowSidebar] = useState(false);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [nodeModeChosen, setNodeModeChosen] = useState(false);

  useEffect(() => {
    // Check if node mode was already chosen
    getSavedNodeMode().then((mode) => {
      if (mode) {
        setNodeModeChosen(true);
        doInit();
      }
    });
    const unsub = subscribe(() => setTick((n) => n + 1));
    return () => { unsub(); shutdown(); };
  }, []);

  const doInit = () => {
    init().catch((e) => console.error("init failed:", e));
  };

  const handleNodeSelect = async (mode: NodeMode) => {
    await saveNodeMode(mode);
    setNodeModeChosen(true);
    doInit();
  };

  const { state, creatorView, status, nodeStatus, identity, nodeMode } = getState();

  const selectedForm = state?.forms[selectedId] || null;
  const isCreator = !!(creatorView && selectedForm && creatorView.forms.includes(selectedForm.id));
  const responses = creatorView?.responses[selectedId] || [];

  const handleCreate = async (title: string) => {
    try {
      // Simple form: single text question
      const questions: Question[] = [
        { id: "q1", type: "text", text: "Your response", required: true },
      ];
      const fid = await createForm(title, "", questions);
      setSelectedId(fid);
      setShowCreate(false);
      setShowSidebar(false);
    } catch (e: any) {
      Alert.alert("Error", "Create failed: " + e.message);
    }
  };

  const handleSubmit = async () => {
    if (!selectedForm) return;
    const ans = selectedForm.questions
      .filter((q) => answers[q.id])
      .map((q) => ({ question: q.text, answer: answers[q.id] }));
    if (ans.length === 0) { Alert.alert("Hint", "Answer at least one question"); return; }
    try {
      await submitResponse(selectedForm.id, ans);
      setAnswers({});
      Alert.alert("Done", "Response submitted ✓");
    } catch (e: any) {
      Alert.alert("Error", "Submit failed: " + e.message);
    }
  };

  const shareUri = selectedForm
    ? `whisperbox://form?id=${selectedForm.id}`
    : "";

  // ── Node Selection Screen ──
  if (!nodeModeChosen) {
    return (
      <SafeAreaView style={styles.safe}>
        <StatusBar barStyle="light-content" backgroundColor={C.bg} />
        <View style={styles.nodeSelect}>
          <Text style={styles.nodeSelectIcon}>🔒</Text>
          <Text style={styles.nodeSelectTitle}>WhisperBox</Text>
          <Text style={styles.nodeSelectSub}>Choose how to connect</Text>

          <TouchableOpacity style={styles.nodeOption} onPress={() => handleNodeSelect("shared")}>
            <View style={styles.nodeOptionIcon}>
              <Text>🌐</Text>
            </View>
            <View style={styles.nodeOptionBody}>
              <Text style={styles.nodeOptionTitle}>Shared Node</Text>
              <Text style={styles.nodeOptionDesc}>
                Use the Logos Delivery app on this device. Lower battery, always-on sync.
              </Text>
            </View>
          </TouchableOpacity>

          <TouchableOpacity style={styles.nodeOption} onPress={() => handleNodeSelect("embedded")}>
            <View style={styles.nodeOptionIcon}>
              <Text>📱</Text>
            </View>
            <View style={styles.nodeOptionBody}>
              <Text style={styles.nodeOptionTitle}>Embedded Node</Text>
              <Text style={styles.nodeOptionDesc}>
                Run your own node in Edge mode. No other apps needed, uses more battery.
              </Text>
            </View>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />

      {/* ── Top Bar ── */}
      <View style={styles.topBar}>
        <TouchableOpacity style={styles.hamburger} onPress={() => setShowSidebar(!showSidebar)}>
          <Text style={styles.hamburgerIcon}>{showSidebar ? "✕" : "☰"}</Text>
        </TouchableOpacity>
        <View style={styles.topBarTitle}>
          <Text style={styles.topBarAppName}>WhisperBox</Text>
          <View style={styles.statusPill}>
            <View style={[styles.dot, { backgroundColor: nodeStatus === "connected" ? C.success : nodeStatus === "connecting" ? C.warning : C.error }]} />
            <Text style={styles.statusPillText}>
              {nodeStatus === "connected" ? "online" : nodeStatus === "connecting" ? "connecting…" : "offline"}
            </Text>
          </View>
        </View>
        <TouchableOpacity style={styles.newBtnSmall} onPress={() => setShowCreate(true)}>
          <Text style={styles.newBtnSmallText}>+</Text>
        </TouchableOpacity>
      </View>

      {/* ── Sidebar (overlay) ── */}
      {showSidebar && (
        <View style={styles.sidebarOverlay}>
          <TouchableOpacity
            style={styles.sidebarBackdrop}
            activeOpacity={1}
            onPress={() => setShowSidebar(false)}
          />
          <View style={styles.sidebar}>
            <View style={styles.sidebarHeader}>
              <Text style={styles.sidebarTitle}>Forms</Text>
              <TouchableOpacity onPress={() => setShowSidebar(false)}>
                <Text style={styles.sidebarClose}>✕</Text>
              </TouchableOpacity>
            </View>

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
                    onPress={() => { setSelectedId(fid); setAnswers({}); setShowSidebar(false); }}
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
              {(!state?.feed || state.feed.length === 0) && (
                <View style={styles.emptySidebar}>
                  <Text style={styles.emptySidebarText}>No forms yet</Text>
                  <Text style={styles.emptySidebarSub}>Tap + to create one</Text>
                </View>
              )}
            </ScrollView>

            <View style={styles.sidebarFooter}>
              <Text style={styles.sidebarFooterText}>
                {identity ? identity.address.slice(0, 8) + "…" : "—"} · {nodeMode === "shared" ? "shared" : "edge"}
              </Text>
            </View>
          </View>
        </View>
      )}

      {/* ── Main Content ── */}
      <View style={styles.main}>
        {!selectedForm ? (
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>📋</Text>
            <Text style={styles.emptyTitle}>No form selected</Text>
            <Text style={styles.emptySub}>
              {state?.feed?.length
                ? "Open the menu (☰) to pick a form"
                : "Tap + to create your first form"}
            </Text>
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.detail}>
            {/* Header */}
            <View style={styles.detailHeader}>
              <Text style={styles.detailTitle}>{selectedForm.title}</Text>
              {isCreator && (
                <TouchableOpacity style={styles.shareBtn} onPress={() => setShowShare(true)}>
                  <Text style={styles.shareBtnText}>Share</Text>
                </TouchableOpacity>
              )}
            </View>

            {selectedForm.description ? (
              <Text style={styles.detailDesc}>{selectedForm.description}</Text>
            ) : null}

            <View style={styles.metaRow}>
              {!(state?.closedForms?.has(selectedForm.id)) && (
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
                </View>

                <View style={styles.shareCard}>
                  <Text style={styles.shareCardLabel}>SHARE THIS FORM</Text>
                  <View style={styles.shareUriBox}>
                    <Text style={styles.shareUriText} numberOfLines={2}>{shareUri}</Text>
                  </View>
                </View>

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
                      multiline
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

      {/* ── Create Overlay (simplified: just a title) ── */}
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

// ── Create Form Overlay (simplified: title only) ──────────────────────────────

function CreateOverlay({ onClose, onCreate }: {
  onClose: () => void;
  onCreate: (title: string) => void;
}) {
  const [title, setTitle] = useState("");

  const doCreate = () => {
    if (!title.trim()) { Alert.alert("Hint", "Give your form a title"); return; }
    onCreate(title.trim());
  };

  return (
    <View style={styles.overlay}>
      <View style={styles.overlayCard}>
        <View style={styles.overlayHeader}>
          <Text style={styles.overlayTitle}>New Form</Text>
          <TouchableOpacity onPress={onClose}>
            <Text style={styles.overlayClose}>✕</Text>
          </TouchableOpacity>
        </View>

        <TextInput
          style={styles.input}
          placeholder="Form title"
          placeholderTextColor={C.textTert}
          value={title}
          onChangeText={setTitle}
          autoFocus
          onSubmitEditing={doCreate}
        />

        <Text style={styles.createHint}>
          Respondents will see a single text field to fill in.
        </Text>

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

  // Node selection
  nodeSelect: {
    flex: 1, justifyContent: "center", padding: 32,
    alignItems: "center",
  },
  nodeSelectIcon: { fontSize: 48, marginBottom: 12 },
  nodeSelectTitle: { fontSize: 28, fontWeight: "700", color: C.text, marginBottom: 4 },
  nodeSelectSub: { fontSize: 14, color: C.textTert, marginBottom: 40 },
  nodeOption: {
    flexDirection: "row", alignItems: "center",
    backgroundColor: C.surface, borderRadius: R.lg,
    padding: 20, width: "100%", marginBottom: 12,
    borderWidth: 1, borderColor: C.border,
  },
  nodeOptionIcon: {
    width: 44, height: 44, borderRadius: R.md,
    backgroundColor: C.primarySubtle,
    alignItems: "center", justifyContent: "center", marginRight: 14,
    fontSize: 20,
  },
  nodeOptionBody: { flex: 1 },
  nodeOptionTitle: { fontSize: 16, fontWeight: "600", color: C.text, marginBottom: 2 },
  nodeOptionDesc: { fontSize: 12, color: C.textTert, lineHeight: 16 },

  // Top bar
  topBar: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: C.borderSubtle,
    backgroundColor: C.bg,
  },
  hamburger: {
    width: 36, height: 36, borderRadius: R.sm,
    backgroundColor: C.surfaceRaised,
    alignItems: "center", justifyContent: "center",
    marginRight: 12,
  },
  hamburgerIcon: { fontSize: 16, color: C.text },
  topBarTitle: { flex: 1, flexDirection: "row", alignItems: "center", gap: 8 },
  topBarAppName: { fontSize: 16, fontWeight: "700", color: C.text },
  statusPill: {
    flexDirection: "row", alignItems: "center",
    backgroundColor: C.surfaceRaised, borderRadius: 10,
    paddingHorizontal: 8, paddingVertical: 3,
  },
  dot: { width: 6, height: 6, borderRadius: 3, marginRight: 5 },
  statusPillText: { fontSize: 10, color: C.textTert },
  newBtnSmall: {
    width: 36, height: 36, borderRadius: R.sm,
    backgroundColor: C.primary,
    alignItems: "center", justifyContent: "center",
    marginLeft: 12,
  },
  newBtnSmallText: { fontSize: 20, color: "#fff", fontWeight: "600" },

  // Sidebar overlay
  sidebarOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 50,
  },
  sidebarBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.5)",
  },
  sidebar: {
    width: "75%", maxWidth: 320,
    backgroundColor: C.surface,
    borderTopRightRadius: R.lg,
    borderBottomRightRadius: R.lg,
    paddingTop: 16, paddingBottom: 12,
    paddingHorizontal: 16,
  },
  sidebarHeader: {
    flexDirection: "row", justifyContent: "space-between",
    alignItems: "center", marginBottom: 12,
  },
  sidebarTitle: { fontSize: 18, fontWeight: "700", color: C.text },
  sidebarClose: { fontSize: 14, color: C.textTert, padding: 4 },
  sidebarFooter: {
    paddingTop: 8, borderTopWidth: 1, borderTopColor: C.borderSubtle,
  },
  sidebarFooterText: { fontSize: 11, color: C.textTert },
  emptySidebar: { alignItems: "center", paddingVertical: 40 },
  emptySidebarText: { fontSize: 14, color: C.textSec, marginBottom: 4 },
  emptySidebarSub: { fontSize: 12, color: C.textTert },

  // Form list
  formList: { flex: 1 },
  formItem: {
    flexDirection: "row", alignItems: "center",
    padding: 12, borderRadius: R.md, marginBottom: 4,
    borderWidth: 1, borderColor: "transparent",
  },
  formItemActive: { backgroundColor: C.primarySubtle, borderColor: C.primary },
  formIcon: {
    width: 32, height: 32, borderRadius: R.sm,
    backgroundColor: C.primarySubtle,
    alignItems: "center", justifyContent: "center", marginRight: 10,
  },
  formBody: { flex: 1 },
  formTitle: { fontSize: 14, fontWeight: "600", color: C.text },
  formMeta: { fontSize: 11, color: C.textTert },
  mineBadge: {
    backgroundColor: C.primarySubtle, borderRadius: 10,
    paddingHorizontal: 7, paddingVertical: 2,
  },
  mineBadgeText: { fontSize: 10, fontWeight: "600", color: C.primary },

  // Main content
  main: { flex: 1, backgroundColor: C.bg },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32 },
  emptyIcon: { fontSize: 40, marginBottom: 12, opacity: 0.5 },
  emptyTitle: { fontSize: 18, fontWeight: "600", color: C.textSec, marginBottom: 4 },
  emptySub: { fontSize: 13, color: C.textTert, textAlign: "center" },

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
    color: C.text, fontSize: 14,
    borderWidth: 1, borderColor: C.border,
    minHeight: 44,
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
    backgroundColor: "rgba(11,11,16,0.85)",
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
  createHint: { fontSize: 12, color: C.textTert, marginTop: 8, marginBottom: 4 },

  // Buttons
  newBtn: {
    backgroundColor: C.primary, borderRadius: R.md,
    paddingVertical: 10, paddingHorizontal: 20, alignItems: "center",
  },
  newBtnText: { color: "#fff", fontSize: 13, fontWeight: "600" },
  sectionLabel: {
    fontSize: 10, fontWeight: "600", color: C.textTert,
    marginBottom: 8, marginTop: 4,
  },
});
