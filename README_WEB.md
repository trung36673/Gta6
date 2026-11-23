# LUCIA: NIGHT CITY — Web build

## Chạy trên máy tính
1. Cài Python 3.
2. Mở terminal tại thư mục này.
3. Chạy: `python run_local.py`
4. Mở URL được in ra trong trình duyệt.

## Chạy trên Android
Không mở `index.html` trực tiếp bằng `file://` vì trình duyệt chặn tải ES modules và mô hình GLB.
Hãy chạy máy chủ HTTP cục bộ bằng ứng dụng hỗ trợ Python/web server, hoặc chạy trên máy tính cùng Wi-Fi rồi mở URL trên Chrome Android.

## Đưa lên hosting
Tải toàn bộ nội dung thư mục này lên static hosting (GitHub Pages/Netlify/Vercel).
Giữ nguyên cấu trúc `index.html`, `game.js`, `style.css`, `assets/`.
Game tải Three.js từ CDN nên cần Internet.

## Điều khiển
- PC: WASD / phím mũi tên, Shift để chạy, E để tương tác.
- Mobile: kéo joystick, giữ nút chạy, chạm TƯƠNG TÁC.
