/* แดชบอร์ด DMC สพม.ชัยภูมิ — อ่านข้อมูลจาก Google Sheet แบบอย่างเดียว (ไม่มีการเขียนกลับ) */
(function () {
  "use strict";

  var cfg = window.DMC_CONFIG || {};
  var ZONES = window.SCHOOL_ZONES || {};
  var state = { rows: [], filter: "all", q: "", mine: null, dataTime: null };

  var MONTHS = { "ม.ค.": 0, "ก.พ.": 1, "มี.ค.": 2, "เม.ย.": 3, "พ.ค.": 4, "มิ.ย.": 5, "ก.ค.": 6, "ส.ค.": 7, "ก.ย.": 8, "ต.ค.": 9, "พ.ย.": 10, "ธ.ค.": 11 };
  var MONTH_NAMES = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
  var TZ = 7 * 3600000; // แสดงผลเป็นเวลาไทย (Asia/Bangkok) เสมอกันไม่ว่าเครื่องผู้ใช้ตั้งโซนไหน

  /* ---------- helpers ---------- */
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }

  function parseCsv(text) {
    var rows = [], row = [], cur = "", q = false, i = 0, c;
    text = text.replace(/^\uFEFF/, "");
    for (; i < text.length; i++) {
      c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else { q = false; } }
        else { cur += c; }
      } else if (c === '"') { q = true; }
      else if (c === ",") { row.push(cur); cur = ""; }
      else if (c === "\n") { row.push(cur); rows.push(row); row = []; cur = ""; }
      else if (c === "\r") { /* skip */ }
      else { cur += c; }
    }
    if (cur !== "" || row.length) { row.push(cur); rows.push(row); }
    return rows;
  }

  function tsOf(y, mo, d, h, mi, s) { return Date.UTC(y, mo, d, h, mi, s || 0) - TZ; }

  /* คืนค่าเป็น epoch (ms) ของเวลาไทย หรือ null ถ้าอ่านไม่ได้ — ไม่เดาจาก new Date() เพื่อกันค่าขยะ */
  function toTs(v) {
    if (v == null) return null;
    var s = String(v).trim();
    if (s.length < 8) return null;
    var m = s.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})(?::(\d{2}))?/);
    if (m) return tsOf(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
    m = s.match(/(\d{1,2})\s+([^\s\d]{2,6})\.?\s+(\d{4})\s*(?:เวลา)?\s*(\d{1,2})[.:](\d{2})/);
    if (m) {
      var mk = m[2].replace(/\.$/, "") + ".";
      if (MONTHS[mk] != null) return tsOf(+m[3] - 543, MONTHS[mk], +m[1], +m[4], +m[5]);
    }
    m = s.match(/(\d{1,2})[\/.](\d{1,2})[\/.](\d{4})\s+(\d{1,2})[.:](\d{2})/);
    if (m) {
      var yr = +m[3] > 2400 ? +m[3] - 543 : +m[3];
      return tsOf(yr, +m[2] - 1, +m[1], +m[4], +m[5]);
    }
    return null;
  }

  function pad(n) { return ("0" + n).slice(-2); }

  function fmt(t) {
    if (t == null) return "—";
    var d = new Date(t + TZ);
    return d.getUTCDate() + " " + MONTH_NAMES[d.getUTCMonth()] + " " + (d.getUTCFullYear() + 543) +
      " " + pad(d.getUTCHours()) + ":" + pad(d.getUTCMinutes());
  }

  function parseDeadline(v) {
    if (!v) return null;
    var s = String(v).trim();
    if (/[zZ]$|[+-]\d{2}:\d{2}$/.test(s)) { var t = Date.parse(s); return isNaN(t) ? null : t; }
    var m = s.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})/);
    return m ? tsOf(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) : null;
  }

  function pct(n, d) { return d ? Math.round((n / d) * 100) : 0; }

  function gviz(tab) {
    return "https://docs.google.com/spreadsheets/d/" + encodeURIComponent(cfg.sheetId) +
      "/gviz/tq?tqx=out:csv&sheet=" + encodeURIComponent(tab) + "&_=" + Date.now();
  }

  function fetchTab(tab) {
    return fetch(gviz(tab), { cache: "no-store" }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.text();
    });
  }

  /* ---------- data model ---------- */
  function statusOf(raw, time) {
    var v = String(raw || "").trim();
    if (v) {
      /* "ยังไม่ยืนยัน" / "ยังไม่รับรอง" มีคำว่า ยืนยัน/รับรอง อยู่ด้วย ต้องจับคำปฏิเสธก่อน */
      if (/ยังไม่|ไม่ได้|^ไม่/.test(v)) return "pending";
      if (/รับรอง/.test(v)) return "approved";
      if (/ยืนยัน/.test(v)) return "confirmed";
      return "pending";
    }
    if (time) return "confirmed";
    return "pending";
  }

  function buildModel(csvText) {
    var rows = parseCsv(csvText);
    var hi = -1;
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].some(function (c) { return String(c).trim() === "โรงเรียน"; })) { hi = i; break; }
    }
    if (hi < 0) throw new Error("ไม่พบแถวหัวตาราง (คอลัมน์ 'โรงเรียน') ในแท็บ " + cfg.tabData);

    var h = rows[hi].map(function (c) { return String(c).trim(); });
    var iSchool = h.indexOf("โรงเรียน");
    /* มองเฉพาะหัวคอลัมน์ที่อยู่หลังคอลัมน์โรงเรียน และชื่อสั้น (กันเซลล์หัวเรื่องยาว ๆ ที่ข้อความหน้าเว็บปนมา) */
    var pick = function (fn) {
      for (var k = iSchool + 1; k < h.length; k++) {
        if (h[k] && h[k].length <= 40 && fn(h[k])) return k;
      }
      return -1;
    };
    /* รองรับ 2 หน้าตาแท็บ data:
       (A) คัดลอกหน้า DMC มาทั้งบล็อก — มีคอลัมน์เวลา แต่หัวคอลัมน์สถานะเพี้ยน ("สถานะวันปิดระบบ")
       (B) ตารางสถานะอย่างเดียว — หัวคอลัมน์ "Admin รร. ยืนยันข้อมูล" / "ผอ.รร. รับรองข้อมูล" และมีคอลัมน์สหวิทยาเขต
       ยึดชื่อหัวคอลัมน์ก่อน ถ้าหาไม่ได้จึงยึดคอลัมน์เวลาที่อยู่ติดกัน */
    var iZone = pick(function (n) { return /สหวิทยาเขต/.test(n); });
    var iSchoolTime = pick(function (n) { return /เวลาที่ยืนยัน/.test(n); });
    var iLogin = pick(function (n) { return /login/i.test(n); });
    var iDirTime = pick(function (n) { return /รับรอง/.test(n) && /เวลา/.test(n); });
    var iSchoolStatus = pick(function (n) { return /ยืนยัน/.test(n) && !/รับรอง/.test(n) && !/เวลา/.test(n); });
    if (iSchoolStatus < 0 && iSchoolTime > 0) iSchoolStatus = iSchoolTime - 1;
    if (iSchoolStatus < 0) iSchoolStatus = pick(function (n) { return /^สถานะ/.test(n); });
    var iDirStatus = pick(function (n) { return /รับรอง/.test(n) && !/เวลา/.test(n); });
    if (iDirStatus < 0 && iDirTime > 0) iDirStatus = iDirTime - 1;
    var iNote = pick(function (n) { return /หมายเหตุ/.test(n); });

    var out = [];
    for (var r = hi + 1; r < rows.length; r++) {
      var row = rows[r];
      var school = String(row[iSchool] || "").trim();
      if (!school) continue;
      if (/^รวม/.test(school) || /รวมทั้งหมด/.test(row.join(" "))) break;
      var m = school.match(/^(\d{5,10})\s*-\s*(.+)$/);
      var code = m ? m[1] : "";
      var name = m ? m[2].trim() : school;
      var stSchoolRaw = iSchoolStatus >= 0 ? row[iSchoolStatus] : "";
      var stDirRaw = iDirStatus >= 0 ? row[iDirStatus] : "";
      var tSchool = iSchoolTime >= 0 ? toTs(row[iSchoolTime]) : null;
      var tDir = iDirTime >= 0 ? toTs(row[iDirTime]) : null;
      var tLogin = iLogin >= 0 ? toTs(row[iLogin]) : null;

      var schoolState = statusOf(stSchoolRaw, tSchool);
      var dirState = statusOf(stDirRaw, tDir);
      if (dirState === "approved" && schoolState === "pending") schoolState = "confirmed";

      var overall = dirState === "approved" ? "approved" : (schoolState === "confirmed" ? "confirmed" : "pending");
      var meta = ZONES[code] || {};
      var zoneInSheet = iZone >= 0 ? String(row[iZone] || "").trim() : "";
      out.push({
        code: code, name: name,
        zone: zoneInSheet || meta.zone || "ไม่ระบุสหวิทยาเขต",
        overall: overall,
        rawSchool: String(stSchoolRaw || "").trim(),
        rawDir: String(stDirRaw || "").trim(),
        note: iNote >= 0 ? String(row[iNote] || "").trim() : "",
        tSchool: tSchool, tDir: tDir, tLogin: tLogin,
        lastTouch: tDir || tSchool || tLogin
      });
    }
    if (!out.length) throw new Error("อ่านแถวข้อมูลไม่ได้ (พบหัวตารางแต่ไม่มีข้อมูล)");
    /* บอกผู้เรียกว่าชีทนี้มีคอลัมน์อะไรบ้าง เพื่อไม่ให้เดาว่า "ไม่มีเวลา" = "ไม่เคยเข้าใช้" */
    out.hasTime = out.some(function (x) { return x.tSchool || x.tDir; });
    out.hasLogin = out.some(function (x) { return !!x.tLogin; });
    out.hasNote = iNote >= 0;
    return out;
  }

  /* ---------- render ---------- */
  var BADGE = {
    approved: { cls: "badge-ok", label: "รับรองแล้ว" },
    confirmed: { cls: "badge-warn", label: "ยืนยันแล้ว รอรับรอง" },
    pending: { cls: "badge-bad", label: "ยังไม่ยืนยัน" }
  };
  var ICON_LINK = '<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M6.5 9.5a3 3 0 0 0 4.2 0l2.1-2.1a3 3 0 0 0-4.2-4.2l-.9.9"/><path d="M9.5 6.5a3 3 0 0 0-4.2 0L3.2 8.6a3 3 0 0 0 4.2 4.2l.9-.9"/></svg>';

  function schoolUrl(code) { return location.pathname + "?school=" + encodeURIComponent(code); }
  function copyBtn(x) {
    return '<button class="copy" data-code="' + esc(x.code) + '" type="button" aria-label="คัดลอกลิงก์ของโรงเรียน' + esc(x.name) + '">' +
      ICON_LINK + '<span>คัดลอกลิงก์</span></button>';
  }
  function nameLink(x) {
    return x.code ? '<a href="' + esc(schoolUrl(x.code)) + '">' + esc(x.name) + '</a>' : esc(x.name);
  }
  /* ข้อความเวลา/หมายเหตุของแต่ละโรงเรียน ใช้ร่วมกันทั้งคิวงาน ตาราง และมุมมองโรงเรียน */
  function whenOf(x, rows) {
    if (x.overall === "approved") return x.tDir ? "รับรอง " + fmt(x.tDir) + " น." : (x.note || "");
    if (x.overall === "confirmed") return x.tSchool ? "ยืนยัน " + fmt(x.tSchool) + " น." : (x.note || "");
    if (rows.hasLogin) return x.tLogin ? "เข้าใช้ล่าสุด " + fmt(x.tLogin) + " น." : "";
    return x.note || "";
  }
  function neverLogged(x, rows) { return rows.hasLogin && !x.tLogin && x.overall === "pending"; }

  function counts(rows) {
    var c = { approved: 0, confirmed: 0, pending: 0, nologin: 0, total: rows.length };
    rows.forEach(function (x) {
      c[x.overall]++;
      if (rows.hasLogin && !x.tLogin) c.nologin++;
    });
    return c;
  }

  function renderHeader(dataTime, fetchedAt) {
    $("org").textContent = cfg.org || "";
    var nb = $("noticeBanner");
    if (cfg.notice) { nb.hidden = false; nb.textContent = cfg.notice; } else { nb.hidden = true; }
    if (cfg.title) $("title").textContent = cfg.title;
    if (cfg.logo) { var lg = $("logo"); lg.src = cfg.logo; lg.hidden = false; }
    $("roundName").textContent = cfg.roundName || "";
    $("dataTime").textContent = dataTime ? "ข้อมูล ณ " + fmt(dataTime) + " น." : (cfg.dataNote || "ยังไม่ระบุเวลาข้อมูล");
    $("fetchedAt").textContent = "หน้านี้ดึงข้อมูลล่าสุดเมื่อ " + fmt(fetchedAt) + " น.";
    $("fetchedAt").hidden = false;
    $("sheetLink").href = "https://docs.google.com/spreadsheets/d/" + cfg.sheetId + "/edit";
    renderCountdown();
  }

  function deadlineText() {
    var dl = parseDeadline(cfg.deadline);
    return dl == null ? "" : fmt(dl) + " น.";
  }

  function renderCountdown() {
    var el = $("countdown");
    var dl = parseDeadline(cfg.deadline);
    if (dl == null) { el.hidden = true; return; }
    el.hidden = false;
    var ms = dl - Date.now();
    el.classList.toggle("is-over", ms <= 0);
    el.classList.toggle("is-near", ms > 0 && ms < 24 * 3600000);
    if (ms <= 0) {
      $("cdLeft").textContent = "ครบกำหนดแล้ว";
      $("cdAt").textContent = "กำหนด " + fmt(dl) + " น.";
      return;
    }
    var mins = Math.floor(ms / 60000), days = Math.floor(mins / 1440), hrs = Math.floor((mins % 1440) / 60), mm = mins % 60;
    var txt = days > 0 ? days + " วัน " + hrs + " ชม." : (hrs > 0 ? hrs + " ชม. " + mm + " นาที" : mm + " นาที");
    $("cdLeft").textContent = "เหลือเวลา " + txt;
    $("cdAt").textContent = "ถึงกำหนด " + fmt(dl) + " น.";
  }

  function renderSummary(rows) {
    var c = counts(rows);
    $("kApproved").textContent = c.approved;
    $("kConfirmed").textContent = c.confirmed;
    $("kPending").textContent = c.pending;
    $("kNoLogin").textContent = c.nologin;
    $("noLoginItem").hidden = !rows.hasLogin || !c.nologin;
    $("pillNoLogin").hidden = !rows.hasLogin;
    Array.prototype.forEach.call(document.querySelectorAll(".pill-n"), function (n) {
      var k = n.getAttribute("data-n");
      n.textContent = k === "all" ? c.total : c[k];
    });

    /* ความกว้างใช้สัดส่วนจริง (ไม่ปัด) เพื่อให้สามส่วนรวมกันเต็มแถบพอดี */
    var fa = c.total ? c.approved / c.total * 100 : 0, fw = c.total ? c.confirmed / c.total * 100 : 0;
    $("barOk").style.width = fa + "%";
    $("barWarn").style.width = fw + "%";
    $("barOkNum").textContent = c.approved;
    $("barWarnNum").textContent = c.confirmed;
    $("barBadNum").textContent = c.pending;
    $("barOk").classList.toggle("no-num", fa < 8);
    $("barWarn").classList.toggle("no-num", fw < 8);
    $("barBad").classList.toggle("no-num", !c.total || c.pending / c.total < .08);
    $("progressBar").setAttribute("aria-label",
      "รับรองแล้ว " + c.approved + " ยืนยันแล้วรอรับรอง " + c.confirmed + " ยังไม่ยืนยัน " + c.pending + " จาก " + c.total + " โรงเรียน");
    $("progressText").textContent = "รับรองแล้ว " + c.approved + " จาก " + c.total + " โรงเรียน (" + pct(c.approved, c.total) + "%)";
    renderHeadline(c);
    renderQueue(rows);
    renderZones(rows);
  }

  function renderZones(rows) {
    var zones = {};
    rows.forEach(function (x) {
      var z = zones[x.zone] || (zones[x.zone] = { name: x.zone, approved: 0, confirmed: 0, pending: 0, total: 0 });
      z[x.overall]++; z.total++;
    });
    var list = Object.keys(zones).map(function (k) { return zones[k]; })
      .sort(function (a, b) {
        return ((b.pending + b.confirmed) - (a.pending + a.confirmed)) || (b.pending - a.pending) || a.name.localeCompare(b.name, "th");
      });
    $("zones").innerHTML = list.map(function (z) {
      var left = z.confirmed + z.pending;
      return '<li class="zone' + (left ? "" : " is-done") + '">' +
        '<span class="zone-name">' + esc(z.name) + '</span>' +
        '<span class="zone-num">รับรอง <b>' + z.approved + '</b>/' + z.total +
        (left ? ' · ยังไม่ครบ <b>' + left + '</b>' : ' · ครบแล้ว') + '</span>' +
        '<span class="zone-bar" aria-hidden="true">' +
        '<i class="zone-ok" style="width:' + (z.approved / z.total * 100) + '%"></i>' +
        '<i class="zone-warn" style="width:' + (z.confirmed / z.total * 100) + '%"></i>' +
        '</span></li>';
    }).join("");
  }

  function mineRow() {
    if (!state.mine) return null;
    return state.rows.filter(function (x) { return x.code === state.mine; })[0] || null;
  }

  /* พาดหัวบอกเรื่องจริงของข้อมูล ไม่ใช่คำโปรยตายตัว */
  function renderHeadline(c) {
    var h = $("headline");
    var row = mineRow();
    if (row) {
      h.textContent = row.overall === "approved" ? row.name + " รับรองข้อมูลครบแล้ว"
        : row.overall === "confirmed" ? row.name + " ยืนยันแล้ว รอ ผอ. รับรอง"
          : row.name + " ยังไม่ยืนยันข้อมูล";
      return;
    }
    var left = c.confirmed + c.pending;
    if (!c.total) { h.textContent = "ไม่พบข้อมูลโรงเรียน"; return; }
    if (left === 0) { h.textContent = "ทั้ง " + c.total + " โรงเรียน ยืนยันและรับรองข้อมูลครบถ้วนแล้ว"; return; }
    h.textContent = "ยังมีอีก " + left + " โรงเรียนที่ยืนยันและรับรองข้อมูลไม่ครบ";
  }

  /* คิวงาน: แยกตามว่าใครต้องทำต่อ — โรงเรียนต้องยืนยัน หรือ ผอ. ต้องรับรอง */
  var QUEUE_LIMIT = 6;
  function renderQueue(rows) {
    var box = $("queue"), empty = $("queueEmpty");
    var groups = [
      { key: "pending", title: "ยังไม่ยืนยัน", hint: "Admin โรงเรียนต้องเข้าระบบ DMC และกดยืนยันข้อมูล" },
      { key: "confirmed", title: "ยืนยันแล้ว รอรับรอง", hint: "ผอ.โรงเรียนต้องเข้าระบบ DMC และรับรองข้อมูล" }
    ];
    var total = 0;
    box.innerHTML = groups.map(function (g) {
      var items = rows.filter(function (x) { return x.overall === g.key; }).sort(function (a, b) {
        /* โรงเรียนที่ไม่เคยเข้าใช้ขึ้นก่อน เพราะต้องโทรตามก่อน */
        return (neverLogged(b, rows) - neverLogged(a, rows)) || String(a.zone).localeCompare(String(b.zone), "th") ||
          String(a.name).localeCompare(String(b.name), "th");
      });
      total += items.length;
      if (!items.length) return "";
      var extra = items.length - QUEUE_LIMIT;
      return '<div class="q-group is-' + g.key + '">' +
        '<div class="q-head"><h3 class="q-title">' + g.title + '</h3><span class="q-count">' + items.length + '</span></div>' +
        '<p class="q-hint">' + g.hint + '</p>' +
        '<ul class="q-list">' + items.map(function (x, i) {
          var when = whenOf(x, rows);
          var sub = esc(x.zone) + (neverLogged(x, rows) ? '<span class="q-when q-flag">ยังไม่เคยเข้าใช้ระบบ</span>' : (when ? '<span class="q-when">' + esc(when) + '</span>' : ""));
          return '<li class="q-item' + (i >= QUEUE_LIMIT ? " is-extra" : "") + '">' +
            '<div><div class="q-name">' + nameLink(x) + '</div><div class="q-sub">' + sub + '</div></div>' +
            copyBtn(x) + '</li>';
        }).join("") + '</ul>' +
        (extra > 0 ? '<button class="more" type="button" aria-expanded="false" data-more="' + extra + '">แสดงอีก ' + extra + ' โรงเรียน</button>' : "") +
        '</div>';
    }).join("");
    $("queueNote").textContent = total ? "รวม " + total + " โรงเรียน" : "";
    empty.hidden = total > 0;
    empty.textContent = "ทุกโรงเรียนยืนยันและได้รับการรับรองข้อมูลครบถ้วนแล้ว";
    Array.prototype.forEach.call(box.querySelectorAll(".more"), function (btn) {
      btn.addEventListener("click", function () {
        var g = btn.parentNode, open = !g.classList.contains("is-open");
        g.classList.toggle("is-open", open);
        btn.setAttribute("aria-expanded", String(open));
        btn.textContent = open ? "ย่อรายการ" : "แสดงอีก " + btn.getAttribute("data-more") + " โรงเรียน";
      });
    });
  }

  function renderTable() {
    var q = state.q.trim().toLowerCase();
    var rows = state.rows.filter(function (x) {
      if (state.mine && x.code !== state.mine) return false;
      if (state.filter !== "all") {
        if (state.filter === "nologin") { if (x.tLogin) return false; }
        else if (x.overall !== state.filter) return false;
      }
      if (!q) return true;
      return (x.name + " " + x.code + " " + x.zone).toLowerCase().indexOf(q) >= 0;
    });
    rows.sort(function (a, b) {
      var rank = { pending: 0, confirmed: 1, approved: 2 };
      return (rank[a.overall] - rank[b.overall]) || String(a.zone).localeCompare(String(b.zone), "th") ||
        String(a.name).localeCompare(String(b.name), "th");
    });

    $("timeHead").textContent = state.rows.hasTime ? "เวลาล่าสุด" : (state.rows.hasNote ? "หมายเหตุ" : "");

    $("tbody").innerHTML = rows.map(function (x) {
      var b = BADGE[x.overall];
      var when = neverLogged(x, state.rows) ? "ยังไม่เคยเข้าใช้ระบบ" : whenOf(x, state.rows);
      return '<div class="row' + (state.mine && x.code === state.mine ? " is-mine" : "") + '" role="row">' +
        '<div class="row-main" role="cell"><div class="row-name">' + nameLink(x) + '</div>' +
        '<div class="row-meta">' + esc(x.zone) + (x.code ? " · " + esc(x.code) : "") + '</div></div>' +
        '<div class="row-badge" role="cell"><span class="badge ' + b.cls + '">' + b.label + '</span></div>' +
        '<div class="row-time' + (neverLogged(x, state.rows) ? " is-flag" : "") + '" role="cell">' + esc(when) + '</div>' +
        '<div role="cell" class="row-copy">' + copyBtn(x) + '</div>' +
        '</div>';
    }).join("");
    $("empty").hidden = rows.length > 0;
    $("tableCount").textContent = "แสดง " + rows.length + " จาก " + state.rows.length + " โรงเรียน";
  }

  function copyLink(code, btn) {
    var url = location.origin + location.pathname + "?school=" + encodeURIComponent(code);
    var done = function () {
      toast("คัดลอกลิงก์โรงเรียนแล้ว");
      if (btn) {
        var label = btn.querySelector("span");
        btn.classList.add("is-done");
        if (label) label.textContent = "คัดลอกแล้ว";
        setTimeout(function () { btn.classList.remove("is-done"); if (label) label.textContent = "คัดลอกลิงก์"; }, 2000);
      }
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(done, function () { fallbackCopy(url, done); });
    } else { fallbackCopy(url, done); }
  }

  function fallbackCopy(text, done) {
    var ta = document.createElement("textarea");
    ta.value = text; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); done(); } catch (e) { window.prompt("คัดลอกลิงก์นี้", text); }
    document.body.removeChild(ta);
  }

  var toastTimer = null;
  function toast(msg) {
    var t = $("toast");
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 2200);
  }

  /* มุมมองเฉพาะโรงเรียน: สองขั้นตอนตามลำดับจริง (โรงเรียนยืนยัน → ผอ. รับรอง) และบอกสิ่งที่ต้องทำต่อ */
  function renderSchoolView() {
    var box = $("mine");
    var row = mineRow();
    if (!row) { box.hidden = true; state.mine = null; return; }
    var rows = state.rows;
    var s1done = row.overall !== "pending", s2done = row.overall === "approved";
    var s1state = s1done
      ? (row.tSchool ? "ยืนยันแล้ว " + fmt(row.tSchool) + " น." : "ยืนยันแล้ว")
      : (rows.hasLogin ? (row.tLogin ? "ยังไม่ยืนยัน (เข้าใช้ล่าสุด " + fmt(row.tLogin) + " น.)" : "ยังไม่ยืนยัน และยังไม่เคยเข้าใช้ระบบ") : "ยังไม่ยืนยัน");
    var s2state = s2done
      ? (row.tDir ? "รับรองแล้ว " + fmt(row.tDir) + " น." : "รับรองแล้ว")
      : (s1done ? "รอรับรอง" : "รับรองได้หลังโรงเรียนยืนยันข้อมูล");
    var dl = deadlineText();
    var next = s2done ? "โรงเรียนนี้ดำเนินการครบทั้งสองขั้นตอนแล้ว ไม่ต้องทำอะไรเพิ่ม"
      : s1done ? "ขั้นต่อไป: ผอ.โรงเรียนเข้าระบบ DMC และรับรองข้อมูล" + (dl ? " ภายใน " + dl : "")
        : "ขั้นต่อไป: Admin โรงเรียนเข้าระบบ DMC และกดยืนยันข้อมูล" + (dl ? " ภายใน " + dl : "");
    function step(n, title, st, done, now) {
      return '<li class="step' + (done ? " is-done" : "") + (now ? " is-now" : "") + (now && n === 2 ? " is-waiting" : "") + '">' +
        '<span class="step-mark" aria-hidden="true">' + (done ? "✓" : n) + '</span>' +
        '<div><p class="step-title">' + title + '</p><p class="step-state">' + esc(st) + '</p></div></li>';
    }
    box.hidden = false;
    box.innerHTML =
      '<p class="mine-zone">สหวิทยาเขต' + esc(row.zone) + (row.code ? " · รหัส " + esc(row.code) : "") + '</p>' +
      '<h2 class="mine-name" id="mineName">' + esc(row.name) + '</h2>' +
      '<div class="mine-body"><ol class="steps">' +
      step(1, "Admin โรงเรียนยืนยันข้อมูล", s1state, s1done, !s1done) +
      step(2, "ผอ.โรงเรียนรับรองข้อมูล", s2state, s2done, s1done && !s2done) +
      '</ol><div class="mine-aside">' +
      (row.note ? '<p class="mine-note">หมายเหตุ: ' + esc(row.note) + '</p>' : "") +
      '<p class="mine-next' + (s2done ? " is-done" : "") + '">' + esc(next) + '</p>' +
      '<div class="mine-actions">' + copyBtn(row) + '<a href="' + esc(location.pathname) + '">ดูภาพรวมทั้งเขต</a></div></div></div>';
  }

  function showError(msg) {
    var box = $("errorBox");
    box.hidden = false;
    box.innerHTML = "<strong>อ่านข้อมูลไม่ได้:</strong> " + esc(msg) +
      "<br>ตรวจสอบว่า (1) ชีทถูกแชร์ &quot;ทุกคนที่มีลิงก์มีสิทธิ์อ่าน&quot; (2) ชื่อแท็บ <code>" + esc(cfg.tabData) + "</code> ยังถูกต้อง (3) ค่า SHEET_ID ใน config.js ยังชี้ไฟล์เดิม";
    $("dataTime").textContent = "อ่านข้อมูลไม่สำเร็จ";
    $("headline").textContent = "ยังแสดงสถานะไม่ได้ เพราะอ่านข้อมูลจากชีทไม่สำเร็จ";
    document.body.classList.add("is-error");
  }

  function staleCheck(dataTime, fetchedAt) {
    var ref = dataTime || fetchedAt;
    var hours = (Date.now() - ref) / 3600000;
    var banner = $("staleBanner");
    if (dataTime && hours < -0.5) {
      banner.hidden = false;
      banner.innerHTML = "เวลาข้อมูลที่ระบุ (" + fmt(dataTime) + " น.) เป็นเวลาในอนาคต — ตรวจสอบช่อง A1 ของแท็บ " + esc(cfg.tabMeta) + " อีกครั้ง";
      return;
    }
    if (dataTime && hours > (cfg.staleHours || 3)) {
      banner.hidden = false;
      banner.innerHTML = "ข้อมูลชุดนี้เก่ากว่า " + (cfg.staleHours || 3) + " ชั่วโมง (ข้อมูล ณ " + fmt(dataTime) +
        " น.) — โปรดตรวจสอบว่ามีการวางข้อมูลรอบล่าสุดแล้วหรือยัง";
    } else { banner.hidden = true; }
  }

  /* ---------- boot ---------- */
  function init() {
    var params = new URLSearchParams(location.search);
    state.mine = params.get("school");

    Array.prototype.forEach.call(document.querySelectorAll(".pill"), function (p) {
      p.addEventListener("click", function () {
        Array.prototype.forEach.call(document.querySelectorAll(".pill"), function (o) { o.setAttribute("aria-pressed", "false"); });
        p.setAttribute("aria-pressed", "true");
        state.filter = p.getAttribute("data-filter");
        renderTable();
      });
    });
    /* ปุ่มคัดลอกลิงก์ทุกจุดใช้ตัวฟังเดียว (ปุ่มถูกสร้างใหม่ทุกครั้งที่เรนเดอร์) */
    document.addEventListener("click", function (e) {
      var btn = e.target.closest && e.target.closest(".copy");
      if (btn) copyLink(btn.getAttribute("data-code"), btn);
    });
    $("search").addEventListener("input", function (e) { state.q = e.target.value; renderTable(); });
    setInterval(renderCountdown, 60000);

    var fetchedAt = Date.now();
    var metaP = fetchTab(cfg.tabMeta).then(function (txt) {
      var rows = parseCsv(txt);
      var now = Date.now(), lo = now - 40 * 86400000, hi = now + 7 * 86400000;
      for (var i = 0; i < rows.length; i++) {
        for (var j = 0; j < rows[i].length; j++) {
          var t = toTs(rows[i][j]);
          /* รับเฉพาะเวลาที่สมเหตุสมผล กันกรณีไม่มีแท็บ meta แล้ว gviz คืนเนื้อหาแท็บอื่นมาแทน */
          if (t && t >= lo && t <= hi) return t;
        }
      }
      return null;
    }).catch(function () { return null; });

    Promise.all([fetchTab(cfg.tabData), metaP]).then(function (res) {
      state.rows = buildModel(res[0]);
      state.dataTime = res[1];
      renderHeader(state.dataTime, fetchedAt);
      renderSummary(state.rows);
      renderSchoolView();
      renderTable();
      staleCheck(state.dataTime, fetchedAt);

      var expected = Object.keys(ZONES).length;
      if (expected && state.rows.length < expected) {
        var banner = $("staleBanner");
        banner.hidden = false;
        banner.innerHTML = "อ่านข้อมูลได้ " + state.rows.length + " จาก " + expected + " โรงเรียน — อาจวางข้อมูลไม่ครบหรือแท็บถูกแก้โครงสร้าง";
      }
    }).catch(function (err) {
      showError(err && err.message ? err.message : "ไม่ทราบสาเหตุ");
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
