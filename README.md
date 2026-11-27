# NEON CITY – Lucia (game 3D kiểu GTA, ban đêm cyberpunk)

## Chạy nhanh
- **Máy tính:** `python3 serve.py` → mở http://localhost:8080 (Chrome/Edge/Firefox).
- **Điện thoại:** chạy `serve.py` trên máy tính, mở `http://IP-máy:8080` trên điện thoại cùng WiFi → menu Chrome ▸ *Thêm vào màn hình chính* để chạy như app toàn màn hình (PWA, cache offline sau lần đầu).
- Không mở trực tiếp file `index.html` bằng đúp chuột (trình duyệt chặn module/fetch) — dùng `serve.py`.

## APK
Máy build APK cần JDK 17 + Android SDK + Node:
`bash android/build_apk.sh` → `android/android/app/build/outputs/apk/debug/app-debug.apk`.
Hoặc đẩy thư mục này lên GitHub: workflow `.github/workflows/build-apk.yml` tự build APK (tab Actions ▸ Artifacts).

## Điều khiển
Điện thoại: joystick trái = di chuyển · vuốt nửa phải = xoay camera · 🎯 nút to = bắn/đấm · nút ngắm · ↑ nhảy · ✋ nhặt súng/cướp · 🔫 rút/cất súng · ⟳ nạp đạn · CHẠY · bản đồ · GFX (Thấp/TB/Cao/4K).
Máy tính: WASD, chuột (nhìn/bắn), chuột phải ngắm, Shift chạy, Space nhảy, E nhặt/cướp, Q rút-cất súng, R nạp, G thả súng, M bản đồ.

## Gameplay
Nhặt USP 9mm (vật phát sáng vàng gần chỗ xuất hiện) → rút súng, ngắm vào người đi đường: họ **giơ tay**, bấm ✋/E để **cướp tiền**. Bắn/đấm NPC → bị truy nã ★, cảnh sát đuổi và bắn. NPC rơi tiền (xanh) và hộp đạn (cam); vỏ đạn văng ra khi bắn. Côn đồ mang súng, một số NPC đánh trả.

## Cấu trúc
`index.html` (UI + loading) · `js/gl.js` (engine WebGL2: GLB, skinning, bloom) · `js/chars.js` (animation Lucia/NPC) · `js/game.js` (map, AI, chiến đấu) · `assets/*.glb` (đã tối ưu từ model gốc, `tools/optimize_glb.py`).
