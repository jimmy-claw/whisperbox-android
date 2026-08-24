import React, { useEffect, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, StatusBar, SafeAreaView, Alert, NativeModules,
} from "react-native";
import * as loam from "loam-transport";
import {
  init, shutdown, getState, subscribe,
  createForm, updateForm, submitResponse,
  getSavedNodeMode, saveNodeMode, switchNodeMode,
  NodeMode,
} from "./src/app-state";
import { FormDef, Question } from "./src/engine";

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

// ── Shared-node consent banner ────────────────────────────────────────────────
// Mirrors loam-transport's SharedNodeBanner: when we're on the shared Loam node but
// it's not running or this app isn't approved yet, shout + tap-through to open Loam.
function SharedNodeBanner() {
  const [, force] = useState(0);
  useEffect(() => {
    const id = setInterval(() => {
      try { loam.refreshPeerInfo(); } catch { /* */ }
      force((n) => n + 1);
    }, 3000);
    return () => clearInterval(id);
  }, []);

  if (!loam.usingServiceBackend()) return null;   // on our own embedded node — nothing to say
  const down = loam.serviceNodeDown();
  const waiting = loam.serviceAwaitingApproval();
  if (!down && !waiting) return null;             // shared node healthy + approved

  return (
    <TouchableOpacity style={styles.snb} activeOpacity={0.85} onPress={() => loam.launchSharedService()}>
      <Text style={styles.snbIcon}>{down ? "⚠️" : "🔒"}</Text>
      <View style={{ flex: 1 }}>
        <Text style={styles.snbTitle}>{down ? "Loam isn't running" : "WhisperBox isn't approved yet"}</Text>
        <Text style={styles.snbSub}>
          {down
            ? "Tap to open Loam — WhisperBox can't sync until it's running."
            : "Tap to open Loam and approve WhisperBox."}
        </Text>
      </View>
      <Text style={styles.snbCta}>OPEN ›</Text>
    </TouchableOpacity>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────

export default function App() {
  const [, setTick] = useState(0);
  const [selectedId, setSelectedId] = useState("");
  const [showSidebar, setShowSidebar] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const [showDiag, setShowDiag] = useState(false);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  // null = still checking saved mode; true = ready; false = show node selection
  const [nodeModeChosen, setNodeModeChosen] = useState<boolean | null>(null);
  // Form editor: null = closed; {} = creating; FormDef = editing
  const [editor, setEditor] = useState<{ form: FormDef | null } | null>(null);

  useEffect(() => {
    getSavedNodeMode().then((mode) => {
      if (mode) {
        setNodeModeChosen(true);
        doInit();
      } else {
        setNodeModeChosen(false); // first launch → pick a node
      }
    });
    const unsub = subscribe(() => setTick((n) => n + 1));
    return () => { unsub(); shutdown(); };
  }, []);

  const doInit = () => {
    init().catch((e) => console.error("init failed:", e));
  };

  const handleNodeSelect = async (mode: NodeMode) => {
    const { identity } = getState();
    if (identity) {
      await switchNodeMode(mode); // already running → hot-swap the backend
    } else {
      await saveNodeMode(mode);
      doInit();
    }
    setNodeModeChosen(true);
  };

  const { state, creatorView, nodeStatus, identity, nodeMode } = getState();

  const selectedForm = state?.forms[selectedId] || null;
  const isCreator = !!(creatorView && selectedForm && creatorView.forms.includes(selectedForm.id));
  const responses = creatorView?.responses[selectedId] || [];

  const handleCreate = async (title: string, questions: Question[]) => {
    try {
      const fid = await createForm(title, "", questions);
      setSelectedId(fid);
      setEditor(null);
      setShowSidebar(false);
    } catch (e: any) {
      Alert.alert("Error", "Create failed: " + e.message);
    }
  };

  const handleEdit = async (title: string, questions: Question[]) => {
    if (!editor?.form) return;
    try {
      await updateForm(editor.form.id, { title, questions });
      setEditor(null);
    } catch (e: any) {
      Alert.alert("Error", "Save failed: " + e.message);
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
  if (nodeModeChosen === false) {
    return (
      <SafeAreaView style={styles.safe}>
        <StatusBar barStyle="light-content" backgroundColor={C.bg} />
        <View style={styles.nodeSelect}>
          <Text style={styles.nodeSelectIcon}>🔒</Text>
          <Text style={styles.nodeSelectTitle}>WhisperBox</Text>
          <Text style={styles.nodeSelectSub}>Choose how to connect</Text>

          <TouchableOpacity style={styles.nodeOption} onPress={() => handleNodeSelect("shared")}>
            <View style={styles.nodeOptionIcon}><Text>🌐</Text></View>
            <View style={styles.nodeOptionBody}>
              <Text style={styles.nodeOptionTitle}>Shared Node</Text>
              <Text style={styles.nodeOptionDesc}>
                Use the Loam app on this device. Lower battery, always-on sync. You'll approve WhisperBox in Loam once.
              </Text>
            </View>
          </TouchableOpacity>

          <TouchableOpacity style={styles.nodeOption} onPress={() => handleNodeSelect("embedded")}>
            <View style={styles.nodeOptionIcon}><Text>📱</Text></View>
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
            <Text style={styles.statusPillText} numberOfLines={1}>
              {nodeStatus === "connected" ? "online"
                : nodeStatus === "connecting" ? "connecting…"
                : nodeStatus.startsWith("error") ? nodeStatus.slice(0, 26)
                : "offline"}
            </Text>
          </View>
        </View>
        <TouchableOpacity style={styles.diagBtn} onPress={() => setShowDiag(true)}>
          <Text style={styles.diagBtnText}>🔍</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.newBtnSmall} onPress={() => setEditor({ form: null })}>
          <Text style={styles.newBtnSmallText}>+</Text>
        </TouchableOpacity>
      </View>

      {/* ── Shared-node consent banner ── */}
      {nodeMode === "shared" && <SharedNodeBanner />}

      {/* ── Sidebar (overlay) ── */}
      {showSidebar && (
        <View style={styles.sidebarOverlay}>
          <TouchableOpacity style={styles.sidebarBackdrop} activeOpacity={1} onPress={() => setShowSidebar(false)} />
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
                    <View style={styles.formIcon}><Text>📋</Text></View>
                    <View style={styles.formBody}>
                      <Text style={styles.formTitle} numberOfLines={1}>{f?.title || fid}</Text>
                      <Text style={styles.formMeta}>
                        {(f?.questions?.length || 0) + "q"}
                        {respCount > 0 && ` · ${respCount} resp`}
                      </Text>
                    </View>
                    {mine && (
                      <View style={styles.mineBadge}><Text style={styles.mineBadgeText}>Mine</Text></View>
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
              <TouchableOpacity style={styles.switchNode} onPress={() => setNodeModeChosen(false)}>
                <Text style={styles.switchNodeText}>Switch node</Text>
              </TouchableOpacity>
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
            <View style={styles.detailHeader}>
              <Text style={styles.detailTitle}>{selectedForm.title}</Text>
              {isCreator && (
                <View style={styles.headerBtns}>
                  <TouchableOpacity style={styles.editBtn} onPress={() => setEditor({ form: selectedForm })}>
                    <Text style={styles.editBtnText}>Edit</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.shareBtn} onPress={() => setShowShare(true)}>
                    <Text style={styles.shareBtnText}>Share</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>

            {selectedForm.description ? (
              <Text style={styles.detailDesc}>{selectedForm.description}</Text>
            ) : null}

            <View style={styles.metaRow}>
              {!(state?.closedForms?.has(selectedForm.id)) && (
                <View style={styles.openBadge}><Text style={styles.openBadgeText}>Open</Text></View>
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
                    <Text style={styles.statNum}>{responses.filter((r) => r.confirmed).length}</Text>
                    <Text style={styles.statLabel}>Confirmed</Text>
                  </View>
                </View>

                <View style={styles.shareCard}>
                  <Text style={styles.shareCardLabel}>SHARE THIS FORM</Text>
                  <View style={styles.shareUriBox}>
                    <Text style={styles.shareUriText} numberOfLines={2}>{shareUri}</Text>
                  </View>
                </View>

                <Text style={styles.sectionLabel}>RESPONSES ({responses.length})</Text>
                {responses.map((r, i) => (
                  <View key={i} style={styles.respCard}>
                    <View style={styles.respHeader}>
                      <Text style={styles.respAddr}>{r.respondent.slice(0, 6)}…{r.respondent.slice(-4)}</Text>
                      {r.confirmed ? (
                        <View style={styles.confirmedBadge}><Text style={styles.confirmedBadgeText}>✓ Confirmed</Text></View>
                      ) : (
                        <View style={styles.decryptedBadge}><Text style={styles.decryptedBadgeText}>Decrypted</Text></View>
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
                    <Text style={styles.questionText}>{q.text}{q.required ? " *" : ""}</Text>
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

      {/* ── Form Editor (create + edit) ── */}
      {editor && (
        <FormEditor
          initial={editor.form}
          onClose={() => setEditor(null)}
          onSave={editor.form ? handleEdit : handleCreate}
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
            <TouchableOpacity style={[styles.newBtn, { marginTop: 16 }]} onPress={() => setShowShare(false)}>
              <Text style={styles.newBtnText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* ── Diagnostics Overlay ── */}
      {showDiag && <Diagnostics onClose={() => setShowDiag(false)} />}
    </SafeAreaView>
  );
}

// ── Form Editor (create + edit, local-first) ──────────────────────────────────

function FormEditor({ initial, onClose, onSave }: {
  initial: FormDef | null;
  onClose: () => void;
  onSave: (title: string, questions: Question[]) => void;
}) {
  const [title, setTitle] = useState(initial?.title || "");
  const [questions, setQuestions] = useState<Question[]>(
    initial?.questions?.map((q) => ({ ...q })) || []
  );
  const [newQ, setNewQ] = useState("");

  const addQuestion = () => {
    const t = newQ.trim();
    if (!t) return;
    setQuestions((qs) => [
      ...qs,
      { id: "q" + (qs.length + 1) + "-" + Date.now().toString(36), type: "text", text: t, required: false },
    ]);
    setNewQ("");
  };

  const removeQuestion = (i: number) => setQuestions((qs) => qs.filter((_, j) => j !== i));

  const doSave = () => {
    if (!title.trim()) { Alert.alert("Hint", "Give your form a title"); return; }
    if (questions.length === 0) { Alert.alert("Hint", "Add at least one question"); return; }
    onSave(title.trim(), questions);
  };

  return (
    <View style={styles.overlay}>
      <View style={[styles.overlayCard, { maxHeight: "85%" }]}>
        <View style={styles.overlayHeader}>
          <Text style={styles.overlayTitle}>{initial ? "Edit Form" : "New Form"}</Text>
          <TouchableOpacity onPress={onClose}><Text style={styles.overlayClose}>✕</Text></TouchableOpacity>
        </View>

        <Text style={styles.sectionLabel}>TITLE</Text>
        <TextInput
          style={styles.input}
          placeholder="Form title"
          placeholderTextColor={C.textTert}
          value={title}
          onChangeText={setTitle}
          autoFocus={!initial}
        />

        <Text style={styles.sectionLabel}>QUESTIONS ({questions.length})</Text>
        <ScrollView style={styles.draftList}>
          {questions.map((q, i) => (
            <View key={q.id} style={styles.draftQ}>
              <Text style={styles.draftQNum}>{i + 1}.</Text>
              <Text style={styles.draftQText} numberOfLines={2}>{q.text}</Text>
              <TouchableOpacity onPress={() => removeQuestion(i)}>
                <Text style={styles.draftQRemove}>✕</Text>
              </TouchableOpacity>
            </View>
          ))}
        </ScrollView>

        <View style={styles.addQRow}>
          <TextInput
            style={[styles.input, { flex: 1 }]}
            placeholder="Add a question"
            placeholderTextColor={C.textTert}
            value={newQ}
            onChangeText={setNewQ}
            onSubmitEditing={addQuestion}
          />
          <TouchableOpacity style={styles.addQBtn} onPress={addQuestion}>
            <Text style={styles.addQBtnText}>+</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.overlayFooter}>
          <TouchableOpacity onPress={onClose}><Text style={styles.cancelText}>Cancel</Text></TouchableOpacity>
          <TouchableOpacity style={styles.newBtn} onPress={doSave}>
            <Text style={styles.newBtnText}>{initial ? "Save" : "Create"}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

// ── Diagnostics (runtime probe — reveals why the node won't connect) ──────────
// The #1 suspects: (a) native module not registered in this build, (b) the .so
// fails to load at runtime. This screen surfaces both directly.
function Diagnostics({ onClose }: { onClose: () => void }) {
  const [diag, setDiag] = useState<Record<string, string>>({});
  const [probe, setProbe] = useState<string>("");
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    setBusy(true);
    const d: Record<string, string> = {};
    d["NativeModules.LogosMessaging (embedded)"] = NativeModules.LogosMessaging ? "PRESENT" : "MISSING";
    d["NativeModules.LogosDeliveryClient (shared)"] = NativeModules.LogosDeliveryClient ? "PRESENT" : "MISSING";
    const safe = (k: string, fn: () => any) => { try { d[k] = String(fn()); } catch (e: any) { d[k] = "threw: " + (e?.message || e); } };
    safe("deliveryAvailable()", () => loam.deliveryAvailable());
    safe("usingServiceBackend()", () => loam.usingServiceBackend());
    safe("serviceNodeDown()", () => loam.serviceNodeDown());
    safe("serviceAwaitingApproval()", () => loam.serviceAwaitingApproval());
    safe("getStoreInfo()", () => loam.getStoreInfo() || "(empty)");
    safe("getCtx()", () => loam.getCtx() || "(empty)");
    safe("counters", () => JSON.stringify(loam.counters));
    try { d["serviceDiag()"] = await loam.serviceDiag(); } catch (e: any) { d["serviceDiag()"] = "threw: " + (e?.message || e); }
    const { nodeMode, nodeStatus, status } = getState();
    d["nodeMode"] = nodeMode;
    d["nodeStatus"] = nodeStatus;
    d["status"] = status;
    setDiag(d);
    setBusy(false);
  };

  // Directly load the embedded node's native lib and surface the exact error.
  // Result is shown in a MODAL (unmissable, no scrolling) AND at the top of the panel.
  const doProbe = async () => {
    setProbe("probing…");
    let result: string;
    if (!NativeModules.LogosMessaging) {
      result = "✗ LogosMessaging module MISSING — not registered in this build";
    } else {
      try {
        await NativeModules.LogosMessaging.setup();
        result = "✓ LogosMessaging.setup() OK — native .so loaded";
      } catch (e: any) {
        result = "✗ LogosMessaging.setup() FAILED: " + (e?.message || String(e));
      }
    }
    setProbe(result);
    // Full summary in a modal so it can't be missed / scrolled past.
    const { nodeMode, nodeStatus, status } = getState();
    Alert.alert("Native lib probe", [
      result,
      "",
      "nodeMode: " + nodeMode,
      "nodeStatus: " + nodeStatus,
      "status: " + status,
    ].join("\n"));
  };

  useEffect(() => { refresh(); }, []);

  const rows = Object.entries(diag);
  return (
    <View style={styles.overlay}>
      <View style={[styles.overlayCard, { maxHeight: "85%" }]}>
        <View style={styles.overlayHeader}>
          <Text style={styles.overlayTitle}>Diagnostics</Text>
          <TouchableOpacity onPress={onClose}><Text style={styles.overlayClose}>✕</Text></TouchableOpacity>
        </View>
        <ScrollView>
          {/* Probe result at the TOP so it's visible without scrolling */}
          <Text style={styles.sectionLabel}>NATIVE LIB PROBE (embedded node)</Text>
          <Text style={styles.diagVal}>{probe || "(tap ‘Probe native lib’ to test loading the .so)"}</Text>
          <Text style={styles.sectionLabel}>STATE</Text>
          {rows.map(([k, v]) => (
            <View key={k} style={styles.diagRow}>
              <Text style={styles.diagKey}>{k}</Text>
              <Text style={styles.diagVal} numberOfLines={3}>{v}</Text>
            </View>
          ))}
        </ScrollView>
        <View style={styles.overlayFooter}>
          <TouchableOpacity style={styles.editBtn} onPress={doProbe}>
            <Text style={styles.editBtnText}>Probe native lib</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.newBtn} onPress={refresh}>
            <Text style={styles.newBtnText}>{busy ? "…" : "Refresh"}</Text>
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
  nodeSelect: { flex: 1, justifyContent: "center", padding: 32, alignItems: "center" },
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
    alignItems: "center", justifyContent: "center", marginRight: 14, fontSize: 20,
  },
  nodeOptionBody: { flex: 1 },
  nodeOptionTitle: { fontSize: 16, fontWeight: "600", color: C.text, marginBottom: 2 },
  nodeOptionDesc: { fontSize: 12, color: C.textTert, lineHeight: 16 },

  // Shared-node banner
  snb: {
    flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: "#c2410c", margin: 12, borderRadius: R.md,
    paddingVertical: 14, paddingHorizontal: 16,
  },
  snbIcon: { fontSize: 22 },
  snbTitle: { color: "#fff", fontWeight: "700", fontSize: 14 },
  snbSub: { color: "rgba(255,255,255,0.85)", fontSize: 12, marginTop: 2 },
  snbCta: { color: "#fff", fontWeight: "700", fontSize: 13 },

  // Top bar
  topBar: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: C.borderSubtle, backgroundColor: C.bg,
  },
  hamburger: {
    width: 36, height: 36, borderRadius: R.sm,
    backgroundColor: C.surfaceRaised,
    alignItems: "center", justifyContent: "center", marginRight: 12,
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
    alignItems: "center", justifyContent: "center", marginLeft: 12,
  },
  newBtnSmallText: { fontSize: 20, color: "#fff", fontWeight: "600" },

  // Sidebar overlay
  sidebarOverlay: { ...StyleSheet.absoluteFillObject, zIndex: 50 },
  sidebarBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.5)" },
  sidebar: {
    width: "75%", maxWidth: 320,
    backgroundColor: C.surface,
    borderTopRightRadius: R.lg, borderBottomRightRadius: R.lg,
    paddingTop: 16, paddingBottom: 12, paddingHorizontal: 16,
  },
  sidebarHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  sidebarTitle: { fontSize: 18, fontWeight: "700", color: C.text },
  sidebarClose: { fontSize: 14, color: C.textTert, padding: 4 },
  sidebarFooter: {
    paddingTop: 8, borderTopWidth: 1, borderTopColor: C.borderSubtle,
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
  },
  sidebarFooterText: { fontSize: 11, color: C.textTert, flex: 1 },
  switchNode: {
    backgroundColor: C.surfaceRaised, borderRadius: R.sm,
    paddingHorizontal: 10, paddingVertical: 5,
    borderWidth: 1, borderColor: C.border,
  },
  switchNodeText: { fontSize: 11, color: C.primary, fontWeight: "600" },
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
  mineBadge: { backgroundColor: C.primarySubtle, borderRadius: 10, paddingHorizontal: 7, paddingVertical: 2 },
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
  headerBtns: { flexDirection: "row", gap: 8 },
  editBtn: {
    backgroundColor: C.surfaceRaised, borderRadius: R.md,
    paddingHorizontal: 12, paddingVertical: 6,
    borderWidth: 1, borderColor: C.border,
  },
  editBtnText: { fontSize: 12, fontWeight: "600", color: C.primary },
  shareBtn: {
    backgroundColor: C.surfaceRaised, borderRadius: R.md,
    paddingHorizontal: 12, paddingVertical: 6,
    borderWidth: 1, borderColor: C.border,
  },
  shareBtnText: { fontSize: 12, fontWeight: "600", color: C.text },
  detailDesc: { fontSize: 13, color: C.textSec, marginBottom: 8 },
  metaRow: { flexDirection: "row", alignItems: "center", marginBottom: 16 },
  openBadge: { backgroundColor: "#1a3d2a", borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2, marginRight: 8 },
  openBadgeText: { fontSize: 10, fontWeight: "600", color: C.success },
  metaText: { fontSize: 12, color: C.textTert },

  // Stats
  statsRow: { flexDirection: "row", gap: 8, marginBottom: 16 },
  statCard: { flex: 1, backgroundColor: C.surfaceRaised, borderRadius: R.md, paddingVertical: 12, alignItems: "center" },
  statNum: { fontSize: 24, fontWeight: "700", color: C.text },
  statLabel: { fontSize: 11, color: C.textTert, marginTop: 2 },

  // Share card
  shareCard: {
    backgroundColor: C.surfaceRaised, borderRadius: R.md,
    padding: 14, marginBottom: 16, borderWidth: 1, borderColor: C.borderSubtle,
  },
  shareCardLabel: { fontSize: 10, fontWeight: "600", color: C.textTert, marginBottom: 8 },
  shareUriBox: {
    backgroundColor: C.bg, borderRadius: R.sm,
    paddingHorizontal: 10, paddingVertical: 8, borderWidth: 1, borderColor: C.border,
  },
  shareUriText: { fontSize: 11, fontFamily: "monospace", color: C.textSec },
  sharePrivacy: { fontSize: 12, color: C.textTert, marginTop: 10 },

  // Responses
  respCard: {
    backgroundColor: C.surfaceRaised, borderRadius: R.md,
    padding: 14, marginBottom: 8, borderWidth: 1, borderColor: C.borderSubtle,
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
    borderWidth: 1, borderColor: C.border, minHeight: 44,
  },
  submitBtn: { backgroundColor: C.accent, borderRadius: R.md, paddingVertical: 14, alignItems: "center", marginTop: 8 },
  submitBtnText: { fontSize: 15, fontWeight: "700", color: C.bg },
  privacyNote: {
    backgroundColor: "#1a2a1a", borderRadius: R.md,
    padding: 14, marginTop: 12, borderWidth: 1, borderColor: "#2a4d3a",
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
    padding: 20, width: "100%", borderWidth: 1, borderColor: C.border,
  },
  overlayHeader: { flexDirection: "row", justifyContent: "space-between", marginBottom: 16 },
  overlayTitle: { fontSize: 20, fontWeight: "700", color: C.text },
  overlayClose: { fontSize: 14, color: C.textTert },
  overlayFooter: { flexDirection: "row", justifyContent: "flex-end", gap: 12, marginTop: 16 },
  cancelText: { fontSize: 14, color: C.textTert, alignSelf: "center" },

  // Form editor
  sectionLabel: { fontSize: 10, fontWeight: "600", color: C.textTert, marginBottom: 8, marginTop: 12 },
  draftList: { maxHeight: 180, marginBottom: 8 },
  draftQ: {
    flexDirection: "row", alignItems: "center",
    backgroundColor: C.surfaceRaised, borderRadius: R.sm,
    paddingHorizontal: 10, paddingVertical: 8, marginBottom: 4,
    borderWidth: 1, borderColor: C.border,
  },
  draftQNum: { fontSize: 12, fontWeight: "600", color: C.primary, marginRight: 8, width: 20 },
  draftQText: { flex: 1, fontSize: 13, color: C.text },
  draftQRemove: { fontSize: 12, color: C.textTert, padding: 4 },
  addQRow: { flexDirection: "row", gap: 8, marginTop: 4 },
  addQBtn: {
    width: 44, backgroundColor: C.surfaceRaised, borderRadius: R.md,
    alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderColor: C.border,
  },
  addQBtnText: { fontSize: 18, color: C.textTert },

  // Buttons
  newBtn: {
    backgroundColor: C.primary, borderRadius: R.md,
    paddingVertical: 10, paddingHorizontal: 20, alignItems: "center",
  },
  newBtnText: { color: "#fff", fontSize: 13, fontWeight: "600" },

  // Diagnostics
  diagBtn: {
    width: 36, height: 36, borderRadius: R.sm,
    backgroundColor: C.surfaceRaised,
    alignItems: "center", justifyContent: "center", marginLeft: 8, marginRight: 8,
    borderWidth: 1, borderColor: C.border,
  },
  diagBtnText: { fontSize: 15 },
  diagRow: { marginBottom: 10 },
  diagKey: { fontSize: 11, fontWeight: "600", color: C.textSec, marginBottom: 2 },
  diagVal: { fontSize: 12, fontFamily: "monospace", color: C.text, backgroundColor: C.bg, borderRadius: R.sm, padding: 8, borderWidth: 1, borderColor: C.borderSubtle },
});
