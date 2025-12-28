let isAuthed = false;
let selected = null;        // الصراف المختار
let visitedSet = new Set(); // atm_id التي تمت زيارتها

const el = (id) => document.getElementById(id);

function setMsg(id, text, ok = true) {
  const node = el(id);
  if (!node) return;
  node.textContent = text;
  node.style.color = ok ? "#0a7" : "#c00";
}

function enableControls(enabled) {
  if (el("gmapsBtn")) el("gmapsBtn").disabled = !enabled;
  if (el("requestNo")) el("requestNo").disabled = !enabled;
  if (el("saveBtn")) el("saveBtn").disabled = !enabled;
}

function openGoogleMaps(lat, lng) {
  const url = `https://www.google.com/maps?q=${lat},${lng}`;
  window.open(url, "_blank");
}

function normalizeRequestNo(v) {
  return (v ?? "").trim();
}

function getInspectorId() {
  return (localStorage.getItem("inspector_id") || "").trim().toUpperCase();
}

function setInspectorId(v) {
  localStorage.setItem("inspector_id", v);
}


async function loadAtms() {
  const inspectorId = getInspectorId();
  if (!inspectorId) return [];

  const { data, error } = await window.sb
    .from("atms")
    .select("atm_id, bank, city, lat, lng, inspector_id")
    .eq("inspector_id", inspectorId);

  if (error) throw error;
  return data ?? [];
}


async function loadVisits() {
  // تقدروا لاحقًا تفلترها حسب inspector_id بعد ما نضيفه للزيارات
  const { data, error } = await window.sb
    .from("atm_visits")
    .select("atm_id, request_no");
  if (error) throw error;
  return data ?? [];
}

function refreshStats(total) {
  if (el("totalCount")) el("totalCount").textContent = String(total);
  if (el("visitedCount")) el("visitedCount").textContent = String(visitedSet.size);
}

(async function main() {
  // خريطة السعودية تقريبًا
  const map = L.map("map").setView([23.8859, 45.0792], 6);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19
  }).addTo(map);

  setMsg("statusMsg", "جاري تحميل البيانات…", true);

  /* ========= تفعيل كود المراقب ========= */
  const insBtn = el("insBtn");
  const insCodeInput = el("insCode");
  const insMsg = el("insMsg");

  // لو سبق اختار كود، نعرضه
  const currentIns = getInspectorId();
  if (insCodeInput && currentIns) insCodeInput.value = currentIns;

  if (insBtn) {
    insBtn.addEventListener("click", () => {
      const v = (insCodeInput?.value || "").trim().toUpperCase();
      if (!["A", "B"].includes(v)) {
        if (insMsg) insMsg.textContent = "الكود لازم يكون A أو B";
        return;
      }
      setInspectorId(v);
      if (insMsg) insMsg.textContent = `تم التفعيل ✅ (المراقب ${v})`;
      location.reload();
    });
  }
  /* ==================================== */

  // إذا ما اختار كود، نوقف هنا
  if (!getInspectorId()) {
    setMsg("statusMsg", "اختاري كود المراقب أولاً (A أو B).", false);
    enableControls(false);
    return;
  }

  // تحميل الصرافات + الزيارات
  let atms = [];
  try {
    const [a, v] = await Promise.all([loadAtms(), loadVisits()]);
    atms = a;
    visitedSet = new Set((v ?? []).map(x => x.atm_id));
    refreshStats(atms.length);
  } catch (e) {
    setMsg("statusMsg", `فشل تحميل البيانات: ${e.message ?? e}`, false);
    return;
  }

  // رسم الصرافات
  atms.forEach(a => {
    const isVisited = visitedSet.has(a.atm_id);

    const marker = L.marker([a.lat, a.lng], { opacity: isVisited ? 0.5 : 1.0 })
      .addTo(map)
      .on("click", () => {
        selected = a;

        if (el("selectedAtm")) el("selectedAtm").textContent = a.atm_id;
        if (el("selectedCity")) el("selectedCity").textContent = a.city ?? "—";
        if (el("selectedBank")) el("selectedBank").textContent = a.bank ?? "—";

        if (isAuthed) enableControls(true);

        if (visitedSet.has(a.atm_id)) {
          setMsg("statusMsg", "هذا الصراف مسجل مسبقًا.", false);
        } else {
          setMsg("statusMsg", "--", true);
        }
      });

    marker.bindTooltip(`${a.bank ?? ""} - ${a.city ?? ""}`.trim() || a.atm_id);
  });

  setMsg("statusMsg", "تم التحميل البيانات", true);

  // PIN
  if (el("pinBtn")) {
   el("pinBtn").addEventListener("click", () => {
  const pin = (el("pin").value ?? "").trim();

  const pins = window.APP_CONFIG.INSPECTOR_PINS || {};
  const matched = Object.entries(pins).find(([_, p]) => String(p) === pin);

  if (matched) {
    const inspectorId = matched[0]; // A أو B
    setInspectorId(inspectorId);

    isAuthed = true;
    setMsg("pinMsg", `تم الدخول ✅ (المراقب ${inspectorId})`, true);

    // فعّل الأدوات إذا تم اختيار صراف
    if (selected) enableControls(true);

    // أعد تحميل البيانات لتطلع نقاطه
    location.reload();
  } else {
    isAuthed = false;
    enableControls(false);
    setMsg("pinMsg", "PIN غير صحيح", false);
  }
});

  }

  // فتح قوقل ماب
  if (el("gmapsBtn")) {
    el("gmapsBtn").addEventListener("click", () => {
      if (!selected) return;
      openGoogleMaps(selected.lat, selected.lng);
    });
  }

  // حفظ رقم الطلب
  if (el("saveBtn")) {
    el("saveBtn").addEventListener("click", async () => {
      if (!selected) return;

      const requestNo = normalizeRequestNo(el("requestNo")?.value);
      if (!requestNo) {
        setMsg("statusMsg", "رقم الطلب الزامي.", false);
        return;
      }

      if (visitedSet.has(selected.atm_id)) {
        setMsg("statusMsg", "تم تسجيل هذا الصراف مسبقًا.", false);
        return;
      }

      el("saveBtn").disabled = true;

      const inspectorId = getInspectorId();

      const { error } = await window.sb.from("atm_visits").insert({
        atm_id: selected.atm_id,
        request_no: requestNo,
        inspector_id: inspectorId
      });

      if (error) {
        if (String(error.code) === "23505") {
          setMsg("statusMsg", "تم التسجيل مسبقًا (الصراف أو رقم الطلب مكرر).", false);
        } else {
          setMsg("statusMsg", `خطأ: ${error.message}`, false);
        }
        el("saveBtn").disabled = false;
        return;
      }

      visitedSet.add(selected.atm_id);
      refreshStats(atms.length);

      setMsg("statusMsg", "تم الحفظ", true);
      if (el("requestNo")) el("requestNo").value = "";
      el("saveBtn").disabled = false;
    });
  }
})();
