---
description: Sipariş İş Akışı Uygulama Planı
---

# Sipariş Yönetimi İş Akışı - Uygulama Planı

Bu belge, kullanıcının talep ettiği kapsamlı sipariş yönetimi sisteminin adım adım uygulanması için bir plandır.

## Genel Bakış

Sistem şu ana bileşenleri içerecek:
1. **Trendyol API Entegrasyonu** - Siparişleri çekme ve senkronizasyon
2. **Sipariş Durumu Takibi** - waiting → preparing → shipped → cancelled
3. **İptal Yönetimi** - İptal aşamalarını (before_prep, during_prep, after_ship) takip
4. **İade Takibi** - Kargoda iptal edilen ürünlerin geri alınması

## Veritabanı Yapısı

### orders Tablosu
```sql
CREATE TABLE orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id INTEGER NOT NULL,
  order_number TEXT NOT NULL,
  package_number TEXT,
  product_name TEXT,
  barcode TEXT,
  quantity INTEGER,
  status TEXT NOT NULL, -- 'waiting', 'preparing', 'shipped', 'cancelled'
  cancel_stage TEXT, -- 'before_prep', 'during_prep', 'after_ship'
  is_returned BOOLEAN DEFAULT 0,
  order_data TEXT, -- JSON
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
)
```

## Backend (main.js) - IPC Handlers

### 1. orders-sync-from-api
API'den gelen siparişleri veritabanına kaydeder/günceller.

### 2. orders-get-by-status
Belirli bir statüdeki siparişleri getirir.

### 3. orders-update-status
Sipariş durumunu günceller (preparing, shipped, vb.)

### 4. orders-detect-cancellations
API'den gelen sipariş listesiyle DB'yi karşılaştırır, iptal edilenleri tespit eder.

### 5. orders-mark-returned
İptal edilen ve kargoda olan siparişlerin iade durumunu işaretler.

## Frontend Değişiklikleri

### 1. UI Güncellemeleri (index.html)

#### a) Header'a "İptaller" Butonu Ekleme
```html
<button id="btn-nav-cancellations">
  <svg>...</svg>
  İptaller
</button>
```

#### b) Trendyol Siparişler Tablosu Üstüne "Hazırlamaya Başla" Butonu
```html
<button id="btn-start-preparation">
  Hazırlamaya Başla
</button>
```

#### c) "Kargolar Kargoya Verildi" Butonu
```html
<button id="btn-mark-shipped">
  Kargolar Kargoya Verildi
</button>
```

#### d) İptaller Sayfası/Tablosu
- İptal edilen siparişlerin listesi
- "Kargoda İptal" etiketli özel satırlar
- "Geri Alındı" checkbox'ları

### 2. JavaScript Mantığı (renderer.js)

#### a) API Senkronizasyonu
```javascript
async function syncTrendyolOrders() {
  // 1. API'den siparişleri çek
  const result = await ipcRenderer.invoke('fetch-trendyol-orders', storeId)
  
  // 2. Veritabanına kaydet
  await ipcRenderer.invoke('orders-sync-from-api', {
    storeId,
    orders: result.data
  })
  
  // 3. İptalleri tespit et
  const orderNumbers = result.data.map(o => o.orderNumber)
  const cancelled = await ipcRenderer.invoke('orders-detect-cancellations', {
    storeId,
    currentOrderNumbers: orderNumbers
  })
  
  // 4. UI'ı güncelle
  renderOrdersTable()
  highlightCancelledOrders(cancelled.cancelled)
}
```

#### b) Hazırlama Başlatma
```javascript
function startPreparation() {
  // Seçili siparişlerin durumunu 'preparing' yap
  await ipcRenderer.invoke('orders-update-status', {
    orderIds: selectedOrderIds,
    status: 'preparing'
  })
}
```

#### c) Kargolama
```javascript
async function markAsShipped() {
  // 1. Siparişleri 'shipped' yap
  await ipcRenderer.invoke('orders-update-status', {
    orderIds: preparedOrderIds,
    status: 'shipped'
  })
  
  // 2. Kritik kontrol: API'den iptal listesini çek
  await syncTrendyolOrders()
}
```

#### d) İptal Edilen Siparişleri Vurgulama
```javascript
function highlightCancelledOrders(cancelledOrders) {
  cancelledOrders.forEach(order => {
    const row = document.querySelector(`[data-order-id="${order.id}"]`)
    row.classList.add('bg-red-50')
    row.querySelector('.status').textContent = 'İptal Edildi'
    row.querySelector('input, button').disabled = true
  })
}
```

## İş Akışı Senaryoları

### Senaryo 1: Normal Sipariş Akışı
1. API'den sipariş gelir → status: 'waiting'
2. Kullanıcı "Hazırlamaya Başla" → status: 'preparing'
3. Kargo bilgileri girilir
4. "Kargolar Kargoya Verildi" → status: 'shipped'

### Senaryo 2: Hazırlık Sırasında İptal
1. Sipariş status: 'preparing'
2. Müşteri iptal eder (API'den düşer)
3. Senkronizasyon tespit eder → status: 'cancelled', cancel_stage: 'during_prep'
4. Satır kırmızı vurgulanır, işlemler pasif olur

### Senaryo 3: Kargolama Sonrası İptal
1. Sipariş status: 'shipped'
2. Müşteri iptal eder
3. Senkronizasyon tespit eder → status: 'cancelled', cancel_stage: 'after_ship'
4. "İptaller" sayfasında "Kargoda İptal" etiketi ile görünür
5. Kullanıcı ürünü geri aldığında "Geri Alındı" checkbox'ını işaretler

## Periyodik Senkronizasyon

```javascript
// Her 5 dakikada bir otomatik kontrol
setInterval(async () => {
  if (currentStore) {
    await syncTrendyolOrders()
  }
}, 5 * 60 * 1000)
```

## Uygulama Sırası

1. ✅ Veritabanı tablosu eklendi (orders)
2. ⏳ Backend IPC handler'ları eklenecek
3. ⏳ Frontend UI güncellemeleri yapılacak
4. ⏳ İş akışı fonksiyonları yazılacak
5. ⏳ Test ve iyileştirmeler yapılacak
