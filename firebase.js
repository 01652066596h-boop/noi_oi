/* NỢ ƠI: lớp Firebase dùng chung cho Web (/) và App (/app/).
   Đăng nhập Google qua Firebase Auth; hồ sơ ẩn danh lưu ở Firestore: users/{uid}.
   Email KHÔNG được ghi lên Firestore, chỉ nằm trong Firebase Auth. */
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithPopup, GoogleAuthProvider, signOut, deleteUser, reauthenticateWithPopup }
  from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, updateDoc, deleteDoc, serverTimestamp }
  from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
auth.languageCode = "vi";
const db = getFirestore(app);
const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: "select_account" });

const userDoc = uid => doc(db, "users", uid);
const brief = u => (u ? { uid: u.uid, email: u.email || "" } : null);
const PROFILE_KEYS = ["nick", "ch", "tone", "phone", "verified"];

window.NoiFB = {
  /* cb(user|null) chạy mỗi lần trạng thái đăng nhập đổi, kể cả lúc khởi động */
  onAuth: cb => onAuthStateChanged(auth, u => cb(brief(u))),
  currentUser: () => brief(auth.currentUser),
  async signInGoogle() {
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
  /* Xóa hồ sơ rồi xóa tài khoản Auth; nếu phiên đã cũ thì yêu cầu đăng nhập lại Google */
  async deleteAccount() {
    const u = auth.currentUser; if (!u) return;
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
    if (c === "permission-denied" || c === "firestore/permission-denied") return "Không có quyền ghi hồ sơ. Bạn thử đăng nhập lại nhé.";
    return "Chưa đăng nhập được. Bạn thử lại sau nhé.";
  }
};
window.dispatchEvent(new Event("noifb"));
