# YanHH3D Stremio Addon — Render

Đây là bản **Node.js + Chromium/Playwright** của addon YanHH3D. Bản này giữ resolver trình duyệt của `server.js` cũ, phù hợp với player tạo nhiều nguồn HLS động và hiển thị nhiều Server trong Stremio.

## Cấu trúc chính

| File | Vai trò |
| --- | --- |
| `server.js` | HTTP server Express và các route Stremio |
| `yanhh3d.js` | Scraper, resolver HLS/MP4 và Playwright Chromium |
| `render.yaml` | Blueprint cấu hình service Render |
| `package.json` | Lệnh chạy và dependency Node.js |

## Deploy nhanh bằng Render Blueprint

1. Đưa toàn bộ thư mục này lên một repository GitHub riêng.
2. Vào [Render Dashboard](https://dashboard.render.com/) và chọn **New → Blueprint**.
3. Chọn repository chứa `render.yaml`.
4. Bấm **Apply** hoặc **Create New Resources**.
5. Render sẽ chạy build command để cài dependency và Chromium, sau đó chạy `npm start`.

Blueprint hiện dùng service Node.js gói Free, cổng được lấy từ biến `PORT` do Render cấp. Health check dùng `/health`.

## Deploy thủ công

Nếu không dùng Blueprint, tạo **New → Web Service**, kết nối repository và đặt:

| Thiết lập | Giá trị |
| --- | --- |
| Environment | Node |
| Build Command | `npm ci && npx playwright install --with-deps chromium` |
| Start Command | `npm start` |
| Health Check Path | `/health` |
| Node Version | `20` |
| `RESOLVER_BROWSER` | `1` |

Không đặt `PORT` thủ công; Render tự cấp giá trị cho service.

## Kiểm tra sau deploy

Giả sử Render cấp domain:

```text
https://yanhh3d-stremio-addon-v05.onrender.com
```

Mở lần lượt:

```text
https://yanhh3d-stremio-addon-v05.onrender.com/health
https://yanhh3d-stremio-addon-v05.onrender.com/manifest.json
https://yanhh3d-stremio-addon-v05.onrender.com/debug/resolve/thon-phe-tinh-khong/237
```

Health cần trả về `ok: true` và `browserResolver: true`. Endpoint debug dùng để xem resolver có lấy được các nguồn video hay chưa.

URL dùng để cài addon vào Stremio là:

```text
https://yanhh3d-stremio-addon-v05.onrender.com/manifest.json
```

Hãy thay domain bằng domain thật mà Render cấp.

## Biến môi trường tùy chọn

`RESOLVER_BROWSER=1` bật Chromium resolver. Có thể đặt `YANHH3D_BASES` nếu muốn tự chỉ định danh sách mirror, phân cách bằng dấu phẩy, ví dụ:

```text
YANHH3D_BASES=https://yanhh3d.co,https://yanhh3d.dev
```

Resolver giữ Referer/Origin công khai khi nguồn yêu cầu và trả external page fallback nếu không lấy được native source. Nó không vượt DRM, đăng nhập, paywall hoặc quyền truy cập.

## Chạy cục bộ

```bash
npm ci
npx playwright install --with-deps chromium
npm start
```

Mặc định server lắng nghe `http://localhost:10000` nếu không có biến `PORT`.
