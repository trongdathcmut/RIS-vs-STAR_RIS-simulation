# Mô hình toán và phần geometry tương tác

## 1. Mục tiêu

Mô phỏng công suất thu của một tín hiệu chung từ BS tới hai UE, với và không có vật cản, trước và sau khi dùng RIS/STAR-RIS. Hệ thống SISO băng hẹp, kênh xác định theo hình học.

Tọa độ mặc định:

| Đối tượng | Tọa độ (x, y, z), mét |
|---|---|
| BS | (0, 0, 8) |
| Tâm RIS | (60, 20, 5) |
| UE-R | (40, -10, 1.5) |
| UE-T | (90, -10, 1.5) |
| Vật cản 1 min | (18, -12, 0) |
| Vật cản 1 max | (24, 5, 14) |

## 2. Geometry tương tác

Frontend gửi thêm trường `geometry`:

```json
{
  "surface": [60, 20, 5],
  "users": {
    "R": [40, -10, 1.5],
    "T": [90, -10, 1.5]
  },
  "obstacles": [
    {
      "min": [18, -12, 0],
      "max": [24, 5, 14]
    }
  ]
}
```

Python xác thực tọa độ rồi dùng geometry mới cho toàn bộ phép tính. Vì vậy kéo vật thể không chỉ là hiệu ứng giao diện.

## 3. Kiểm tra vật cản

Mỗi vật cản là hộp chữ nhật AABB. Hàm `intersects` dùng slab test để xác định một đoạn truyền có đi qua hộp hay không.

Một tuyến bị chắn nếu nó giao với ít nhất một vật cản đang bật.

## 4. Kênh

Với khoảng cách d:

h_ab = λ/(4πd) · exp(-j2πd/λ) · 10^(-L/20)

Trong đó L là suy hao vật cản nếu tuyến bị chắn, ngược lại L = 0.

## 5. RIS / STAR-RIS

Các phần tử cách nhau λ/2. Kênh qua bề mặt được tính theo hai chặng:

BS → phần tử n → UE

Công suất thu:

P_r = P_t |h_eff|²

Các chế độ:

- NONE: không bề mặt
- RIS: chỉ phản xạ
- ES: Energy Splitting
- MS: Mode Switching
- TS: Time Switching

## 6. Ý nghĩa khi kéo trên scene

Khi di chuyển UE / RIS / vật cản:

1. JavaScript cập nhật geometry.
2. Geometry được POST đến `/api/simulate`.
3. `model.py` tính lại toàn bộ đường truyền.
4. Giao diện cập nhật công suất, phase map, phasor và biểu đồ.


## 7. Beam pattern mặt cắt phương vị (V4)

Bề mặt nằm trên mặt phẳng YZ (pháp tuyến ±X), tọa độ phần tử là `r_n`.
Tín hiệu chiếu tới mỗi phần tử `h_BS,n` lấy từ cùng hàm `channel` như phần
công suất. Mẫu trường array factor theo vector đơn vị `u(theta)`:

`AF(theta) = Σ_n h_BS,n × sqrt(eta) × w_n × exp(j phi_n) × exp(j k (r_n-r_RIS)·u(theta))`

Trong đó `k=2π/λ` và `w_n` là hệ số biên độ (ES/MS/TS).

Hướng `theta` chạy từ −80 đến +80 độ, góc nâng giữ bằng góc nâng của UE đang
được xem để tạo một **mặt cắt phương vị**. Giá trị đồ thị là
`20log10(|AF(theta)|/max|AF|)`, nên 0 dB luôn ở đỉnh của mỗi cấu hình.
Điều này không phải EIRP và không cho biết công suất thu tuyệt đối.

Mức cộng trường tại hướng UE so sánh `|AF(theta_UE)|` với giới hạn cộng
đồng pha lý tưởng `Σ|h_BS,n sqrt(eta) w_n|`, có đơn vị dB. Khi UE ở gần
RIS, đây chỉ là chỉ số trực quan far-field; công suất UE vẫn tính bằng kênh
truyền hai chặng có khoảng cách từng phần tử.

Nếu chọn **steered**, pha được đặt theo gradient bù cả pha sóng tới:

`phi_n = arg(h_direct) − arg(h_BS,n) − k (r_n−r_RIS)·u(theta_steer) (mod 2π)`

**Lưu ý:** Với mặt sóng tới xiên, mọi pha 0° sẽ không nhất thiết tạo
beam broadside (0°). Với pha được điều khiển theo UE, beam có thể chỉ lệch
một lượng nhỏ do mẫu góc rời rạc 1° và xấp xỉ mặt cắt far-field.
