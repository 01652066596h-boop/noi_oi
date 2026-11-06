/* NỢ ƠI: lớp Firebase dùng chung cho Web (/) và App (/app/).
   Đăng nhập Google qua Firebase Auth; hồ sơ ẩn danh lưu ở Firestore: users/{uid}.
   Email KHÔNG được ghi lên Firestore, chỉ nằm trong Firebase Auth. */
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithPopup, GoogleAuthProvider, signOut, deleteUser, reauthenticateWithPopup, signInWithRedirect, getRedirectResult }
  from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, updateDoc, deleteDoc, serverTimestamp, collection, query, orderBy, limit, where, onSnapshot, writeBatch, getDocs }
  from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

/* Khi chạy trên Firebase Hosting (*.web.app, *.firebaseapp.com) thì dùng chính tên miền đó làm authDomain,
   để đăng nhập chuyển hướng cùng nguồn, chạy ổn trên Safari iPhone. Tên miền khác (GitHub Pages) dùng cửa sổ bật lên. */
const cfg = { ...firebaseConfig };
const onFirebaseHost = /\.(web\.app|firebaseapp\.com)$/.test(location.hostname);
if (onFirebaseHost) cfg.authDomain = location.host;
const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const app = initializeApp(cfg);
const auth = getAuth(app);
auth.languageCode = "vi";
const db = getFirestore(app);
const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: "select_account" });

const redirectDone = getRedirectResult(auth).then(() => null).catch(e => e);
const userDoc = uid => doc(db, "users", uid);
const brief = u => (u ? { uid: u.uid, email: u.email || "" } : null);
const tms = t => (t && t.toMillis ? t.toMillis() : Date.now());
let lastReactions = [];
const PROFILE_KEYS = ["nick", "ch", "tone", "phone", "verified"];

window.NoiFB = {
  /* cb(user|null) chạy mỗi lần trạng thái đăng nhập đổi, kể cả lúc khởi động */
  onAuth: cb => onAuthStateChanged(auth, u => cb(brief(u))),
  currentUser: () => brief(auth.currentUser),
  redirectDone,
  usesRedirect: () => onFirebaseHost && isMobile,
  async signInGoogle() {
    if (onFirebaseHost && isMobile) { await signInWithRedirect(auth, provider); return new Promise(() => {}); }
    const r = await signInWithPopup(auth, provider);
    return brief(r.user);
  },
  signOut: () => signOut(auth),
  async getProfile(uid) {
    const s = await getDoc(userDoc(uid));
    return s.exists() ? s.data() : null;
  },
  async createProfile(uid, p) {
    await setDoc(userDoc(uid), {
      nick: p.nick, anon: p.anon, ch: p.ch, tone: p.tone, year: p.year,
      phone: p.phone || null, verified: !!p.verified, provider: "google",
      createdAt: serverTimestamp()
    });
    return (await getDoc(userDoc(uid))).data();
  },
  async updateProfile(uid, patch) {
    const d = {}; PROFILE_KEYS.forEach(k => { if (k in patch) d[k] = patch[k]; });
    if (Object.keys(d).length) await updateDoc(userDoc(uid), d);
  },

  /* ================= Cộng đồng ================= */
  /* h = { posts(list), comments(list), reactions(list{id,pid,k,uid}), mine(Set id), error(e) } */
  subscribeCommunity(h) {
    const err = e => { console.warn("[firestore]", e && e.code, e && e.message); if (h.error) h.error(e); };
    const opt = { serverTimestamps: "estimate" };
    const row = d => { const x = d.data(opt); x.id = d.id; x.ts = tms(x.ts); return x; };
    const un = [];
    un.push(onSnapshot(query(collection(db, "posts"), orderBy("ts", "desc"), limit(300)), s => h.posts(s.docs.map(row)), err));
    un.push(onSnapshot(query(collection(db, "comments"), orderBy("ts", "asc"), limit(2000)), s => h.comments(s.docs.map(row)), err));
    un.push(onSnapshot(collection(db, "reactions"), s => {
      lastReactions = s.docs.map(d => { const x = d.data(); return { id: d.id, pid: x.pid, k: x.k, uid: d.id.slice(d.id.lastIndexOf("_") + 1) }; });
      h.reactions(lastReactions);
    }, err));
    let unMine = null;
    un.push(onAuthStateChanged(auth, u => {
      if (unMine) { unMine(); unMine = null; }
      h.mine(new Set());
      if (u) unMine = onSnapshot(query(collection(db, "owners"), where("uid", "==", u.uid)), s => h.mine(new Set(s.docs.map(d => d.id))), err);
    }));
    return () => { un.forEach(fn => fn()); if (unMine) unMine(); };
  },
  async createPost(uid, p) {
    const b = writeBatch(db);
    b.set(doc(db, "owners", p.id), { uid, col: "posts" });
    b.set(doc(db, "posts", p.id), {
      aid: p.aid, nick: p.nick, ch: p.ch, tone: p.tone, anon: !!p.anon, cat: p.cat || "other",
      debt: p.debt == null ? null : p.debt, largest: p.largest == null ? null : p.largest, pub: !!p.pub,
      txt: p.txt, goal: p.goal || null, ts: serverTimestamp(), status: "visible", freed: false
    });
    await b.commit();
  },
  async createComment(uid, c) {
    const b = writeBatch(db);
    b.set(doc(db, "owners", c.id), { uid, col: "comments" });
    b.set(doc(db, "comments", c.id), {
      pid: c.pid, parent: c.parent || null, to: c.to || null, aid: c.aid, nick: c.nick, ch: c.ch, tone: c.tone,
      anon: !!c.anon, txt: c.txt, ts: serverTimestamp(), status: "visible"
    });
    await b.commit();
  },
  async deletePost(id) { const b = writeBatch(db); b.delete(doc(db, "posts", id)); b.delete(doc(db, "owners", id)); await b.commit(); },
  async deleteComment(id) { const b = writeBatch(db); b.delete(doc(db, "comments", id)); b.delete(doc(db, "owners", id)); await b.commit(); },
  /* k = 0..5 hoặc null để bỏ */
  async setReaction(uid, pid, k) {
    const ref = doc(db, "reactions", pid + "_" + uid);
    if (k == null) await deleteDoc(ref); else await setDoc(ref, { pid, k });
  },
  async createReport(r) {
    await setDoc(doc(collection(db, "reports")), { type: r.type, tid: r.tid, reason: r.reason, note: r.note || null, ts: serverTimestamp() });
  },
  /* Xóa toàn bộ bài, bình luận, lượt gửi vía của tôi */
  async deleteMyContent(uid) {
    const snap = await getDocs(query(collection(db, "owners"), where("uid", "==", uid)));
    const refs = [];
    snap.docs.forEach(d => { refs.push(doc(db, d.data().col, d.id)); refs.push(d.ref); });
    lastReactions.filter(x => x.uid === uid).forEach(x => refs.push(doc(db, "reactions", x.id)));
    for (let i = 0; i < refs.length; i += 400) { const b = writeBatch(db); refs.slice(i, i + 400).forEach(x => b.delete(x)); await b.commit(); }
  },
  /* Xóa hồ sơ rồi xóa tài khoản Auth; nếu phiên đã cũ thì yêu cầu đăng nhập lại Google */
  async deleteAccount() {
    const u = auth.currentUser; if (!u) return;
    await window.NoiFB.deleteMyContent(u.uid);
    await deleteDoc(userDoc(u.uid));
    try { await deleteUser(u); }
    catch (e) {
      if (e.code === "auth/requires-recent-login") { await reauthenticateWithPopup(u, provider); await deleteUser(u); }
      else throw e;
    }
  },
  errMsg(e) {
    const c = (e && e.code) || "";
    if (c === "auth/popup-closed-by-user" || c === "auth/cancelled-popup-request") return "";
    if (c === "auth/popup-blocked") return "Trình duyệt đang chặn cửa sổ đăng nhập. Bạn cho phép cửa sổ bật lên rồi thử lại nhé.";
    if (c === "auth/network-request-failed") return "Mạng đang chập chờn. Bạn thử lại sau nhé.";
    if (c === "auth/unauthorized-domain") return "Trang này chưa được cấp phép đăng nhập. Quản trị viên cần thêm tên miền vào Firebase Authentication.";
    if (c === "permission-denied" || c === "firestore/permission-denied") return "Máy chủ từ chối thao tác này. Bạn thử đăng nhập lại nhé.";
    return "Chưa đăng nhập được. Bạn thử lại sau nhé.";
  }
};
window.dispatchEvent(new Event("noifb"));
