import { useState, useEffect, useRef } from "react";
import { Analytics } from "@vercel/analytics/react";

const DEFAULT_HABITS = [
  { id: "bible-am", name: "Bible Study", sub: "Morning", time: "06:00", icon: "📖", color: "#FFD93D" },
  { id: "workout",  name: "Workout",     sub: null,      time: "07:00", icon: "💪", color: "#FF6B6B" },
  { id: "port",     name: "Portuguese",  sub: null,      time: "09:00", icon: "🇧🇷", color: "#4ECDC4" },
  { id: "draw",     name: "Drawing",     sub: null,      time: "15:00", icon: "✏️", color: "#FB923C" },
  { id: "read",     name: "Read",        sub: null,      time: "20:00", icon: "📚", color: "#A78BFA" },
  { id: "bible-pm", name: "Bible Study", sub: "Night",   time: "21:00", icon: "📖", color: "#FFD93D" },
];

const ICONS = ["📖","💪","🇧🇷","✏️","📚","🧠","🎯","🏃","🎸","💻","🥗","💧","🧘","🌅","🙏","✍️","🎨","📝","💬","🏋️"];
const COLORS = ["#FF6B6B","#FFD93D","#4ECDC4","#A78BFA","#FB923C","#34D399","#60A5FA","#F472B6","#A3E635","#FBBF24"];
const DAY_LABELS = ["S","M","T","W","T","F","S"];

function getUserId() {
  let id = localStorage.getItem("grind-user-id");
  if (!id) { id = "u_" + Math.random().toString(36).slice(2, 10); localStorage.setItem("grind-user-id", id); }
  return id;
}

function todayKey() { return new Date().toISOString().split("T")[0]; }

function getStreak(completions, habitId) {
  let streak = 0;
  const today = new Date();
  for (let i = 0; i < 365; i++) {
    const d = new Date(today); d.setDate(today.getDate() - i);
    const key = d.toISOString().split("T")[0];
    if (completions[key]?.[habitId]) streak++;
    else if (i > 0) break;
  }
  return streak;
}

function getWeekData(completions, habitId) {
  const result = [];
  const today = new Date();
  const dow = today.getDay();
  for (let i = 0; i < 7; i++) {
    const d = new Date(today); d.setDate(today.getDate() - dow + i);
    result.push({ done: !!completions[d.toISOString().split("T")[0]]?.[habitId], isToday: i === dow });
  }
  return result;
}

function formatTime(t) {
  if (!t) return "";
  const [h, m] = t.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  return `${h % 12 || 12}:${String(m).padStart(2,"0")} ${ampm}`;
}

function groupByPeriod(habits) {
  const morning   = habits.filter(h => { const hr = parseInt(h.time); return hr >= 5 && hr < 12; });
  const afternoon = habits.filter(h => { const hr = parseInt(h.time); return hr >= 12 && hr < 17; });
  const evening   = habits.filter(h => { const hr = parseInt(h.time); return hr >= 17 || hr < 5; });
  return { morning, afternoon, evening };
}

async function storageGet(key) {
  try { if (window.storage) { const r = await window.storage.get(key); return r?.value ?? null; } } catch (_) {}
  return localStorage.getItem(key);
}
async function storageSet(key, val) {
  try { if (window.storage) { await window.storage.set(key, val); return; } } catch (_) {}
  localStorage.setItem(key, val);
}

// Play alarm sound using Web Audio API
function playAlarmSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const times = [0, 0.3, 0.6];
    times.forEach(offset => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.setValueAtTime(880, ctx.currentTime + offset);
      osc.frequency.setValueAtTime(660, ctx.currentTime + offset + 0.1);
      gain.gain.setValueAtTime(0.4, ctx.currentTime + offset);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + offset + 0.25);
      osc.start(ctx.currentTime + offset);
      osc.stop(ctx.currentTime + offset + 0.25);
    });
  } catch (_) {}
}

function scheduleAlarms(habits, completionsRef) {
  if (window._habitAlarmInterval) clearInterval(window._habitAlarmInterval);
  const fired = new Set();
  window._habitAlarmInterval = setInterval(() => {
    const now = new Date();
    const today = now.toISOString().split("T")[0];
    const currentTime = `${String(now.getHours()).padStart(2,"0")}:${String(now.getMinutes()).padStart(2,"0")}`;
    habits.forEach(habit => {
      const key = `${today}_${habit.id}`;
      if (habit.time === currentTime && !fired.has(key) && !completionsRef.current[today]?.[habit.id]) {
        fired.add(key);
        playAlarmSound();
        if ("Notification" in window && Notification.permission === "granted") {
          new Notification(`Time for ${habit.name}${habit.sub ? ` (${habit.sub})` : ""}! ${habit.icon}`, {
            body: `It's ${formatTime(habit.time)} — stay on the grind 🔥`,
            icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🔥</text></svg>"
          });
        }
      }
    });
  }, 10000); // check every 10 seconds — much more reliable
}

function stopAlarms() {
  if (window._habitAlarmInterval) {
    clearInterval(window._habitAlarmInterval);
    window._habitAlarmInterval = null;
  }
}

export default function App() {
  const [userId] = useState(getUserId);
  const [habits, setHabits] = useState(DEFAULT_HABITS);
  const [completions, setCompletions] = useState({});
  const [loaded, setLoaded] = useState(false);
  const [view, setView] = useState("today");
  const [showAdd, setShowAdd] = useState(false);
  const [justDone, setJustDone] = useState(null);
  const [notifPermission, setNotifPermission] = useState(typeof Notification !== "undefined" ? Notification.permission : "denied");
  const [alarmsEnabled, setAlarmsEnabled] = useState(true);
  const [darkMode, setDarkMode] = useState(true);
  const [form, setForm] = useState({ name:"", time:"08:00", icon:"🎯", color:"#FF6B6B", sub:"" });
  const [editId, setEditId] = useState(null);
  const completionsRef = useRef({});

  const habitsKey = `grind-habits-${userId}`;
  const compKey   = `grind-comp-${userId}`;

  // Theme colors
  const t = darkMode ? {
    bg: "#0A0A12", sidebar: "#0D0C18", card: "#13121F",
    border: "rgba(255,255,255,0.05)", borderStrong: "rgba(255,255,255,0.08)",
    text: "#EFEFFF", textMuted: "rgba(255,255,255,0.3)", textFaint: "rgba(255,255,255,0.18)",
    navActive: "#1A1928", input: "rgba(255,255,255,0.06)", inputBorder: "rgba(255,255,255,0.1)",
    sectionLabel: "rgba(255,255,255,0.2)", progressBg: "rgba(255,255,255,0.07)",
    cancelBtn: "rgba(255,255,255,0.06)", cancelText: "rgba(255,255,255,0.5)",
    iconOptBg: "rgba(255,255,255,0.06)", checkBorder: "rgba(255,255,255,0.12)",
    notifBanner: "rgba(255,107,107,0.09)", notifBannerBorder: "rgba(255,107,107,0.2)",
    overlay: "rgba(0,0,0,0.75)", modalBg: "#13121F",
  } : {
    bg: "#F5F4FF", sidebar: "#FFFFFF", card: "#FFFFFF",
    border: "rgba(0,0,0,0.07)", borderStrong: "rgba(0,0,0,0.1)",
    text: "#1A1830", textMuted: "rgba(0,0,0,0.4)", textFaint: "rgba(0,0,0,0.2)",
    navActive: "#F0EFFE", input: "rgba(0,0,0,0.04)", inputBorder: "rgba(0,0,0,0.1)",
    sectionLabel: "rgba(0,0,0,0.25)", progressBg: "rgba(0,0,0,0.07)",
    cancelBtn: "rgba(0,0,0,0.06)", cancelText: "rgba(0,0,0,0.4)",
    iconOptBg: "rgba(0,0,0,0.05)", checkBorder: "rgba(0,0,0,0.15)",
    notifBanner: "rgba(255,107,107,0.07)", notifBannerBorder: "rgba(255,107,107,0.2)",
    overlay: "rgba(0,0,0,0.5)", modalBg: "#FFFFFF",
  };

  useEffect(() => {
    (async () => {
      try {
        const h = await storageGet(habitsKey);
        if (h) setHabits(JSON.parse(h));
        const c = await storageGet(compKey);
        if (c) { const parsed = JSON.parse(c); setCompletions(parsed); completionsRef.current = parsed; }
        const dm = await storageGet("grind-darkmode");
        if (dm !== null) setDarkMode(dm === "true");
      } catch (_) {}
      setLoaded(true);
    })();
  }, []);

  useEffect(() => {
    if (loaded && alarmsEnabled) {
      scheduleAlarms(habits, completionsRef);
    } else {
      stopAlarms();
    }
    return () => stopAlarms();
  }, [habits, loaded, alarmsEnabled]);

  const enableAlarms = async () => {
    if (!("Notification" in window)) return;
    const result = await Notification.requestPermission();
    setNotifPermission(result);
    if (result === "granted") setAlarmsEnabled(true);
  };

  const toggleAlarms = () => {
    const next = !alarmsEnabled;
    setAlarmsEnabled(next);
    if (!next) stopAlarms();
  };

  const toggleDarkMode = () => {
    const next = !darkMode;
    setDarkMode(next);
    storageSet("grind-darkmode", String(next));
  };

  const saveHabits = async (data) => { await storageSet(habitsKey, JSON.stringify(data)); };
  const saveComp   = async (data) => { await storageSet(compKey, JSON.stringify(data)); };

  const toggle = (habitId) => {
    const today = todayKey();
    setCompletions(prev => {
      const next = { ...prev, [today]: { ...prev[today], [habitId]: !prev[today]?.[habitId] } };
      saveComp(next); completionsRef.current = next;
      if (!prev[today]?.[habitId]) setJustDone(habitId);
      return next;
    });
    setTimeout(() => setJustDone(null), 700);
  };

  const addHabit = () => {
    if (!form.name.trim()) return;
    const newHabit = { id: editId || "h_" + Date.now(), name: form.name.trim(), sub: form.sub.trim() || null, time: form.time, icon: form.icon, color: form.color };
    const next = editId ? habits.map(h => h.id === editId ? newHabit : h) : [...habits, newHabit];
    setHabits(next); saveHabits(next);
    setShowAdd(false); setEditId(null);
    setForm({ name:"", time:"08:00", icon:"🎯", color:"#FF6B6B", sub:"" });
  };

  const deleteHabit = (id) => { const next = habits.filter(h => h.id !== id); setHabits(next); saveHabits(next); };
  const startEdit = (habit) => {
    setForm({ name: habit.name, time: habit.time, icon: habit.icon, color: habit.color, sub: habit.sub || "" });
    setEditId(habit.id); setShowAdd(true);
  };

  const today = todayKey();
  const doneToday = habits.filter(h => completions[today]?.[h.id]).length;
  const pct = habits.length ? Math.round((doneToday / habits.length) * 100) : 0;
  const allDone = doneToday === habits.length && habits.length > 0;
  const now = new Date();
  const greeting = now.getHours() < 12 ? "Morning" : now.getHours() < 17 ? "Afternoon" : "Evening";
  const { morning, afternoon, evening } = groupByPeriod(habits);

  const AlarmButton = ({ mobile }) => {
    if (notifPermission !== "granted") {
      return (
        <button className={mobile ? undefined : "nav-item"} onClick={enableAlarms}
          style={mobile ? { background:"rgba(255,107,107,0.15)", border:"1px solid rgba(255,107,107,0.25)", color:"#FF6B6B", borderRadius:10, padding:"8px 12px", fontFamily:"'DM Sans',sans-serif", fontSize:12, fontWeight:600, cursor:"pointer" } : { color:"#FF6B6B" }}>
          {mobile ? "🔔 Enable" : <><span className="nav-icon-s">🔔</span> Enable Alarms</>}
        </button>
      );
    }
    return (
      <button className={mobile ? undefined : "nav-item"} onClick={toggleAlarms}
        style={mobile ? { background: alarmsEnabled ? "rgba(52,211,153,0.15)" : "rgba(255,107,107,0.15)", border: alarmsEnabled ? "1px solid rgba(52,211,153,0.3)" : "1px solid rgba(255,107,107,0.25)", color: alarmsEnabled ? "#34D399" : "#FF6B6B", borderRadius:10, padding:"8px 12px", fontFamily:"'DM Sans',sans-serif", fontSize:12, fontWeight:600, cursor:"pointer" } : { color: alarmsEnabled ? "#34D399" : "#FF6B6B" }}>
        {mobile ? (alarmsEnabled ? "🔔 On" : "🔕 Off") : <><span className="nav-icon-s">{alarmsEnabled ? "✅" : "🔕"}</span> {alarmsEnabled ? "Alarms On · Turn Off" : "Alarms Off · Turn On"}</>}
      </button>
    );
  };

  if (!loaded) return (
    <div style={{ minHeight:"100vh", background:t.bg, display:"flex", alignItems:"center", justifyContent:"center" }}>
      <div style={{ color:t.textMuted, fontFamily:"sans-serif", fontSize:15 }}>Loading…</div>
    </div>
  );

  return (
    <div style={{ minHeight:"100vh", background:t.bg, fontFamily:"'DM Sans',sans-serif", transition:"background 0.3s" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,600&display=swap');
        *, *::before, *::after { box-sizing:border-box; margin:0; padding:0; -webkit-tap-highlight-color:transparent; }
        .layout { display:flex; min-height:100vh; }
        .sidebar { width:240px; min-height:100vh; background:${t.sidebar}; border-right:1px solid ${t.border}; padding:40px 16px; display:flex; flex-direction:column; gap:4px; position:fixed; left:0; top:0; bottom:0; transition:background 0.3s; }
        .sidebar-logo { font-family:'DM Serif Display',serif; font-size:24px; color:${t.text}; margin-bottom:28px; padding-bottom:20px; border-bottom:1px solid ${t.border}; }
        .sidebar-logo span { color:#FF6B6B; }
        .nav-item { display:flex; align-items:center; gap:10px; padding:11px 14px; border-radius:12px; cursor:pointer; border:none; background:transparent; color:${t.textMuted}; font-family:'DM Sans',sans-serif; font-size:14px; font-weight:500; width:100%; text-align:left; transition:all 0.2s; }
        .nav-item:hover { background:${darkMode ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.04)"}; color:${t.text}; }
        .nav-item.active { background:${t.navActive}; color:${t.text}; }
        .nav-icon-s { font-size:18px; width:22px; text-align:center; }
        .main { margin-left:240px; padding:44px 44px 80px; flex:1; }
        @media (max-width:700px) {
          .sidebar { display:none !important; }
          .main { margin-left:0 !important; padding:0 0 90px !important; }
          .mobile-header { display:flex !important; }
          .bottom-nav { display:flex !important; }
          .page-title { font-size:26px !important; }
          .cards-grid { grid-template-columns:1fr !important; }
          .inner-pad { padding:0 14px !important; }
          .stats-grid { grid-template-columns:repeat(2,1fr) !important; }
        }
        .mobile-header { display:none; justify-content:space-between; align-items:center; padding:48px 16px 4px; }
        .bottom-nav { display:none; position:fixed; bottom:0; left:0; right:0; background:${t.sidebar}; border-top:1px solid ${t.border}; padding:10px 0 24px; z-index:50; justify-content:center; gap:50px; transition:background 0.3s; }
        .bottom-nav-btn { display:flex; flex-direction:column; align-items:center; gap:3px; background:none; border:none; cursor:pointer; font-family:'DM Sans',sans-serif; }
        .bottom-nav-label { font-size:10px; font-weight:600; }
        .inner-pad { padding:0; }
        .page-header { margin-bottom:24px; margin-top:4px; }
        .page-greeting { font-size:11px; color:${t.textMuted}; letter-spacing:0.07em; text-transform:uppercase; margin-bottom:6px; }
        .page-title { font-family:'DM Serif Display',serif; font-size:32px; color:${t.text}; line-height:1.1; }
        .progress-wrap { background:${t.card}; border:1px solid ${t.border}; border-radius:16px; padding:16px 20px; margin-bottom:18px; transition:background 0.3s; }
        .progress-top { display:flex; justify-content:space-between; margin-bottom:10px; }
        .progress-label { font-size:13px; color:${t.textMuted}; }
        .progress-pct { font-size:13px; font-weight:600; color:#FFD93D; }
        .progress-bg { height:5px; background:${t.progressBg}; border-radius:3px; overflow:hidden; }
        .progress-fill { height:100%; border-radius:3px; background:linear-gradient(90deg,#FF6B6B,#FFD93D); transition:width 0.6s cubic-bezier(.4,0,.2,1); }
        .stats-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(110px,1fr)); gap:8px; margin-bottom:18px; }
        .stat-card { background:${t.card}; border:1px solid ${t.border}; border-radius:14px; padding:14px; text-align:center; transition:background 0.3s; }
        .stat-num { font-size:26px; font-weight:700; font-family:'DM Serif Display',serif; }
        .stat-label { font-size:10px; color:${t.textMuted}; margin-top:2px; letter-spacing:0.05em; text-transform:uppercase; }
        .all-done { background:linear-gradient(135deg,rgba(255,107,107,0.12),rgba(255,217,61,0.12)); border:1px solid rgba(255,217,61,0.18); border-radius:16px; padding:16px; text-align:center; margin-bottom:18px; animation:fadeUp 0.4s ease; }
        @keyframes fadeUp { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
        .section-label { font-size:10px; font-weight:600; letter-spacing:0.1em; text-transform:uppercase; color:${t.sectionLabel}; margin:20px 0 10px; }
        .cards-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(290px,1fr)); gap:8px; }
        .habit-card { background:${t.card}; border-radius:18px; overflow:hidden; border:1px solid ${t.border}; transition:transform 0.15s, box-shadow 0.15s, background 0.3s; cursor:pointer; -webkit-user-select:none; user-select:none; }
        .habit-card:hover { box-shadow:0 4px 20px ${darkMode ? "rgba(0,0,0,0.3)" : "rgba(0,0,0,0.08)"}; transform:translateY(-1px); }
        .habit-card:active { transform:scale(0.98) !important; }
        .habit-card.done { border-color:${t.borderStrong}; }
        .habit-inner { display:flex; align-items:center; gap:12px; padding:15px 16px; }
        .icon-wrap { width:44px; height:44px; border-radius:12px; display:flex; align-items:center; justify-content:center; font-size:21px; flex-shrink:0; transition:transform 0.3s cubic-bezier(.34,1.56,.64,1); }
        .habit-card.done .icon-wrap { transform:scale(1.08); }
        .habit-name-row { font-size:14px; font-weight:600; color:${t.text}; display:flex; align-items:center; gap:6px; flex-wrap:wrap; }
        .habit-sub { font-size:10px; font-weight:600; padding:2px 7px; border-radius:20px; letter-spacing:0.04em; text-transform:uppercase; }
        .habit-meta { font-size:11px; color:${t.textMuted}; margin-top:3px; display:flex; gap:8px; align-items:center; }
        .streak-badge { font-size:11px; font-weight:600; padding:1px 7px; border-radius:20px; }
        .check-wrap { width:27px; height:27px; border-radius:50%; flex-shrink:0; border:2px solid ${t.checkBorder}; display:flex; align-items:center; justify-content:center; transition:all 0.25s cubic-bezier(.34,1.56,.64,1); }
        .habit-card.done .check-wrap { border-color:transparent; transform:scale(1.1); }
        .checkmark { opacity:0; transform:scale(0); transition:all 0.2s cubic-bezier(.34,1.56,.64,1); font-size:13px; color:${darkMode ? "#0A0A12" : "#FFFFFF"}; font-weight:700; }
        .habit-card.done .checkmark { opacity:1; transform:scale(1); }
        .week-row { display:flex; gap:3px; padding:12px 16px 12px; }
        .done-pulse { animation:pulse 0.5s ease; }
        @keyframes pulse { 0%{transform:scale(1)} 50%{transform:scale(1.025)} 100%{transform:scale(1)} }
        .manage-card { background:${t.card}; border:1px solid ${t.border}; border-radius:16px; padding:14px 16px; display:flex; align-items:center; gap:12px; margin-bottom:8px; transition:background 0.3s; }
        .add-btn { background:none; border:1.5px dashed ${darkMode ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.15)"}; color:${t.textMuted}; border-radius:16px; padding:14px; width:100%; text-align:center; cursor:pointer; font-family:'DM Sans',sans-serif; font-size:14px; transition:all 0.2s; margin-top:4px; }
        .add-btn:hover { border-color:${darkMode ? "rgba(255,255,255,0.3)" : "rgba(0,0,0,0.3)"}; color:${t.text}; }
        .notif-banner { background:${t.notifBanner}; border:1px solid ${t.notifBannerBorder}; border-radius:14px; padding:14px 16px; margin-bottom:16px; display:flex; align-items:center; gap:12px; }
        .notif-btn { background:#FF6B6B; color:#FFFFFF; border:none; border-radius:10px; padding:8px 14px; font-family:'DM Sans',sans-serif; font-weight:600; font-size:13px; cursor:pointer; white-space:nowrap; }
        .overlay { position:fixed; inset:0; background:${t.overlay}; display:flex; align-items:flex-end; justify-content:center; z-index:200; backdrop-filter:blur(6px); }
        @media(min-width:701px){ .overlay { align-items:center; } }
        .modal { background:${t.modalBg}; border-radius:24px 24px 0 0; padding:24px 22px 44px; width:100%; max-width:480px; border:1px solid ${t.borderStrong}; max-height:92vh; overflow-y:auto; transition:background 0.3s; }
        @media(min-width:701px){ .modal { border-radius:20px; } }
        .modal-title { font-family:'DM Serif Display',serif; font-size:22px; color:${t.text}; margin-bottom:20px; }
        .field-label { font-size:10px; font-weight:600; color:${t.textMuted}; letter-spacing:0.08em; text-transform:uppercase; margin-bottom:8px; display:block; }
        .field-input { background:${t.input}; border:1px solid ${t.inputBorder}; border-radius:12px; color:${t.text}; padding:12px 14px; font-size:15px; font-family:'DM Sans',sans-serif; width:100%; outline:none; transition:border-color 0.2s; margin-bottom:16px; }
        .field-input:focus { border-color:${darkMode ? "rgba(255,255,255,0.25)" : "rgba(0,0,0,0.25)"}; }
        .field-input::placeholder { color:${t.textFaint}; }
        .icon-grid { display:flex; flex-wrap:wrap; gap:6px; margin-bottom:16px; }
        .icon-opt { width:38px; height:38px; border-radius:10px; background:${t.iconOptBg}; border:1.5px solid transparent; cursor:pointer; font-size:18px; display:flex; align-items:center; justify-content:center; transition:all 0.15s; }
        .icon-opt.sel { border-color:${darkMode ? "rgba(255,255,255,0.4)" : "rgba(0,0,0,0.3)"}; background:${darkMode ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.08)"}; }
        .color-grid { display:flex; gap:8px; flex-wrap:wrap; margin-bottom:20px; }
        .color-dot { width:30px; height:30px; border-radius:50%; cursor:pointer; transition:transform 0.15s; }
        .color-dot:hover { transform:scale(1.15); }
        .color-dot.sel { outline:3px solid ${darkMode ? "white" : "#333"}; outline-offset:2px; }
        .primary-btn { background:${darkMode ? "white" : "#1A1830"}; color:${darkMode ? "#0A0A12" : "#FFFFFF"}; border:none; border-radius:12px; padding:14px; width:100%; font-family:'DM Sans',sans-serif; font-weight:600; font-size:15px; cursor:pointer; transition:opacity 0.15s; }
        .primary-btn:hover { opacity:0.9; }
        .primary-btn:disabled { opacity:0.4; cursor:not-allowed; }
        .del-btn { background:rgba(255,80,80,0.12); color:#FF6B6B; border:1px solid rgba(255,80,80,0.25); border-radius:10px; padding:9px 14px; font-family:'DM Sans',sans-serif; font-size:13px; cursor:pointer; margin-top:10px; width:100%; }
        .cancel-btn { background:${t.cancelBtn}; color:${t.cancelText}; border:none; border-radius:12px; padding:13px; width:100%; font-family:'DM Sans',sans-serif; font-size:14px; cursor:pointer; margin-top:8px; }
        .theme-toggle { background:none; border:none; cursor:pointer; font-size:20px; padding:4px; border-radius:8px; transition:transform 0.2s; }
        .theme-toggle:hover { transform:scale(1.15); }
      `}</style>

      <div className="layout">
        <div className="sidebar">
          <div className="sidebar-logo">Grind<span>.</span></div>
          <button className={`nav-item ${view==="today"?"active":""}`} onClick={()=>setView("today")}>
            <span className="nav-icon-s">☀️</span> Today
          </button>
          <button className={`nav-item ${view==="manage"?"active":""}`} onClick={()=>setView("manage")}>
            <span className="nav-icon-s">⚙️</span> Manage Habits
          </button>
          <div style={{ marginTop:"auto", paddingTop:20, borderTop:`1px solid ${t.border}` }}>
            <button className="nav-item" onClick={toggleDarkMode} style={{ color: t.textMuted }}>
              <span className="nav-icon-s">{darkMode ? "☀️" : "🌙"}</span>
              {darkMode ? "Light Mode" : "Dark Mode"}
            </button>
            <AlarmButton mobile={false} />
          </div>
        </div>

        <div className="main">
          <div className="mobile-header">
            <div style={{ fontFamily:"'DM Serif Display',serif", fontSize:24, color:t.text }}>
              Grind<span style={{color:"#FF6B6B"}}>.</span>
            </div>
            <div style={{ display:"flex", gap:8, alignItems:"center" }}>
              <button className="theme-toggle" onClick={toggleDarkMode}>{darkMode ? "☀️" : "🌙"}</button>
              <AlarmButton mobile={true} />
            </div>
          </div>

          <div className="inner-pad">
            {view === "today" && (
              <>
                <div className="page-header" style={{ marginTop:20 }}>
                  <div className="page-greeting">{greeting} · {now.toLocaleDateString("en-US",{weekday:"long",month:"short",day:"numeric"})}</div>
                  <div className="page-title">{allDone ? "You crushed it 🔥" : `${doneToday} of ${habits.length} done`}</div>
                </div>
                <div className="progress-wrap">
                  <div className="progress-top">
                    <span className="progress-label">Today's progress</span>
                    <span className="progress-pct">{pct}%</span>
                  </div>
                  <div className="progress-bg"><div className="progress-fill" style={{ width:`${pct}%` }} /></div>
                </div>
                {habits.some(h => getStreak(completions,h.id) > 0) && (
                  <div className="stats-grid">
                    {habits.filter(h => getStreak(completions,h.id) > 0).slice(0,4).map(h => (
                      <div key={h.id} className="stat-card">
                        <div className="stat-num" style={{ color:h.color }}>{getStreak(completions,h.id)}</div>
                        <div className="stat-label">{h.name.split(" ")[0]}</div>
                      </div>
                    ))}
                  </div>
                )}
                {allDone && (
                  <div className="all-done">
                    <div style={{ fontSize:28, marginBottom:6 }}>🏆</div>
                    <div style={{ fontSize:15, fontWeight:700, color:"#FFD93D" }}>All habits complete!</div>
                    <div style={{ fontSize:13, color:t.textMuted, marginTop:4 }}>That's the grind. See you tomorrow.</div>
                  </div>
                )}
                {habits.length === 0 && (
                  <div style={{ textAlign:"center", padding:"60px 20px", color:t.textMuted, fontSize:15 }}>
                    No habits yet — go to Manage to add some!
                  </div>
                )}
                {morning.length > 0 && (<><div className="section-label">Morning</div><div className="cards-grid">{morning.map(h=><HabitCard key={h.id} habit={h} done={!!completions[today]?.[h.id]} streak={getStreak(completions,h.id)} week={getWeekData(completions,h.id)} onToggle={()=>toggle(h.id)} justDone={justDone===h.id} t={t} darkMode={darkMode}/>)}</div></>)}
                {afternoon.length > 0 && (<><div className="section-label">Afternoon</div><div className="cards-grid">{afternoon.map(h=><HabitCard key={h.id} habit={h} done={!!completions[today]?.[h.id]} streak={getStreak(completions,h.id)} week={getWeekData(completions,h.id)} onToggle={()=>toggle(h.id)} justDone={justDone===h.id} t={t} darkMode={darkMode}/>)}</div></>)}
                {evening.length > 0 && (<><div className="section-label">Evening</div><div className="cards-grid">{evening.map(h=><HabitCard key={h.id} habit={h} done={!!completions[today]?.[h.id]} streak={getStreak(completions,h.id)} week={getWeekData(completions,h.id)} onToggle={()=>toggle(h.id)} justDone={justDone===h.id} t={t} darkMode={darkMode}/>)}</div></>)}
              </>
            )}

            {view === "manage" && (
              <>
                <div className="page-header" style={{ marginTop:20 }}>
                  <div className="page-greeting">Customise</div>
                  <div className="page-title">My Habits</div>
                </div>
                {notifPermission !== "granted" && (
                  <div className="notif-banner">
                    <div style={{ flex:1 }}>
                      <div style={{ fontSize:13, fontWeight:600, color:t.text, marginBottom:2 }}>Enable Alarms</div>
                      <div style={{ fontSize:12, color:t.textMuted }}>Get notified at each habit's set time</div>
                    </div>
                    <button className="notif-btn" onClick={enableAlarms}>Enable</button>
                  </div>
                )}
                {habits.map(h => (
                  <div key={h.id} className="manage-card">
                    <div style={{ width:42, height:42, borderRadius:12, background:h.color+"22", display:"flex", alignItems:"center", justifyContent:"center", fontSize:21, flexShrink:0 }}>{h.icon}</div>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontSize:14, fontWeight:600, color:t.text }}>{h.name}{h.sub ? ` · ${h.sub}` : ""}</div>
                      <div style={{ fontSize:12, color:t.textMuted, marginTop:2 }}>{formatTime(h.time)}</div>
                    </div>
                    <button style={{ background:"none", border:"none", cursor:"pointer", fontSize:18, color:t.textMuted, padding:"4px 8px" }} onClick={()=>startEdit(h)}>✏️</button>
                    <button style={{ background:"none", border:"none", cursor:"pointer", fontSize:18, color:"rgba(255,80,80,0.4)", padding:"4px 8px" }} onClick={()=>deleteHabit(h.id)}>🗑️</button>
                  </div>
                ))}
                <button className="add-btn" onClick={()=>{ setShowAdd(true); setEditId(null); setForm({ name:"", time:"08:00", icon:"🎯", color:"#FF6B6B", sub:"" }); }}>
                  + Add new habit
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="bottom-nav">
        <button className="bottom-nav-btn" onClick={()=>setView("today")}>
          <span style={{ fontSize:22 }}>☀️</span>
          <span className="bottom-nav-label" style={{ color: view==="today" ? "#FFD93D" : t.textMuted }}>Today</span>
        </button>
        <button className="bottom-nav-btn" onClick={()=>setView("manage")}>
          <span style={{ fontSize:22 }}>⚙️</span>
          <span className="bottom-nav-label" style={{ color: view==="manage" ? "#FFD93D" : t.textMuted }}>Manage</span>
        </button>
      </div>

      {showAdd && (
        <div className="overlay" onClick={()=>setShowAdd(false)}>
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <div style={{ width:36, height:4, background:t.border, borderRadius:2, margin:"0 auto 20px" }} />
            <div className="modal-title">{editId ? "Edit Habit" : "New Habit"}</div>
            <label className="field-label">Habit Name</label>
            <input className="field-input" placeholder="e.g. Morning Run" value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} autoFocus />
            <label className="field-label">Label (optional — e.g. Morning, Night)</label>
            <input className="field-input" placeholder="e.g. Morning" value={form.sub} onChange={e=>setForm(f=>({...f,sub:e.target.value}))} />
            <label className="field-label">Alarm Time</label>
            <input className="field-input" type="time" value={form.time} onChange={e=>setForm(f=>({...f,time:e.target.value}))} style={{ colorScheme: darkMode ? "dark" : "light" }} />
            <label className="field-label">Icon</label>
            <div className="icon-grid">{ICONS.map(ic=><div key={ic} className={`icon-opt ${form.icon===ic?"sel":""}`} onClick={()=>setForm(f=>({...f,icon:ic}))}>{ic}</div>)}</div>
            <label className="field-label">Color</label>
            <div className="color-grid">{COLORS.map(c=><div key={c} className={`color-dot ${form.color===c?"sel":""}`} style={{ background:c }} onClick={()=>setForm(f=>({...f,color:c}))}/>)}</div>
            <button className="primary-btn" onClick={addHabit} disabled={!form.name.trim()}>{editId ? "Save Changes" : "Add Habit"}</button>
            {editId && <button className="del-btn" onClick={()=>{ deleteHabit(editId); setShowAdd(false); }}>Delete this habit</button>}
            <button className="cancel-btn" onClick={()=>setShowAdd(false)}>Cancel</button>
          </div>
        </div>
      )}
      <Analytics />
    </div>
  );
}

function HabitCard({ habit, done, streak, week, onToggle, justDone, t, darkMode }) {
  return (
    <div className={`habit-card ${done?"done":""} ${justDone?"done-pulse":""}`} onClick={onToggle}>
      <div className="habit-inner">
        <div className="icon-wrap" style={{ background:habit.color+"22" }}>{habit.icon}</div>
        <div style={{ flex:1, minWidth:0 }}>
          <div className="habit-name-row">
            {habit.name}
            {habit.sub && <span className="habit-sub" style={{ background:habit.color+"22", color:habit.color }}>{habit.sub}</span>}
          </div>
          <div className="habit-meta">
            <span>{formatTime(habit.time)}</span>
            {streak > 0 && <span className="streak-badge" style={{ background:habit.color+"22", color:habit.color }}>🔥 {streak}d</span>}
          </div>
        </div>
        <div className="check-wrap" style={done?{background:habit.color}:{}}>
          <span className="checkmark">✓</span>
        </div>
      </div>
      <div className="week-row">
        {week.map((day, i) => (
          <div key={i} style={{ flex:1, position:"relative", paddingTop:14 }}>
            <div style={{ position:"absolute", top:0, left:"50%", transform:"translateX(-50%)", fontSize:9, fontWeight:600, color: day.isToday ? (darkMode ? "rgba(255,255,255,0.5)" : "rgba(0,0,0,0.4)") : (darkMode ? "rgba(255,255,255,0.18)" : "rgba(0,0,0,0.2)") }}>{DAY_LABELS[i]}</div>
            <div style={{ height:3, borderRadius:2, background: day.done ? habit.color : day.isToday ? (darkMode ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.08)") : (darkMode ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.05)"), transition:"background 0.3s" }} />
          </div>
        ))}
      </div>
    </div>
  );
}
