# Veritabanı Teknik Dokümantasyonu

Bu belge, uygulamanın kullandığı SQLite veritabanı yapısını, tablo şemalarını ve kullanılan temel sorguları açıklar.

## 1. Genel Bakış

*   **Veritabanı Teknolojisi:** SQLite3
*   **Dosya Konumu:** `AppData` (veya ilgili OS karşılığı) klasörü altında `stok-takip.db`.
*   **Erişim Yöntemi:** Electron `ipcMain` üzerinden `sqlite3` kütüphanesi kullanılarak erişilir.

## 2. Veritabanı Şeması (Tablolar)

### 2.1. `stores` (Mağazalar)
Mağaza bilgilerini ve API entegrasyon anahtarlarını saklar.

| Alan Adı | Veri Tipi | Açıklama |
| :--- | :--- | :--- |
| `id` | INTEGER | Birincil Anahtar (Auto Increment) |
| `name` | TEXT | Mağaza adı (Benzersiz/Unique) |
| `api_key` | TEXT | Trendyol API Anahtarı |
| `api_secret` | TEXT | Trendyol API Gizli Anahtarı |
| `seller_id` | TEXT | Trendyol Satıcı ID |
| `created_at` | DATETIME | Kayıt oluşturulma tarihi (Varsayılan: Şimdi) |

### 2.2. `products` (Ürünler)
Her mağazaya ait ürün listesini ve eşleştirmeleri saklar.

| Alan Adı | Veri Tipi | Açıklama |
| :--- | :--- | :--- |
| `id` | INTEGER | Birincil Anahtar |
| `store_id` | INTEGER | `stores` tablosuna referans (Foreign Key) |
| `name` | TEXT | Ürün Adı |
| `barcode` | TEXT | Ürün Barkodu |

### 2.3. `import_batches` (İthalat Geçmişi)
Yüklenen Excel dosyalarının işlem kayıtlarını tutar.

| Alan Adı | Veri Tipi | Açıklama |
| :--- | :--- | :--- |
| `id` | INTEGER | Birincil Anahtar |
| `store_id` | INTEGER | `stores` tablosuna referans |
| `filename` | TEXT | Yüklenen dosyanın adı |
| `side` | TEXT | 'source' (Kaynak) veya 'target' (Hedef) |
| `created_at` | DATETIME | İşlem tarihi |

### 2.4. `imported_data` (İçe Aktarılan Veriler)
Her bir toplu işlemin (batch) satır bazlı ham verilerini JSON formatında saklar.

| Alan Adı | Veri Tipi | Açıklama |
| :--- | :--- | :--- |
| `id` | INTEGER | Birincil Anahtar |
| `batch_id` | INTEGER | `import_batches` tablosuna referans |
| `row_data` | TEXT | Satırın tamamını içeren JSON string |

### 2.5. `daily_entries` (Günlük Kayıtlar / Arşiv)
Kargo listeleri ve iptal edilen siparişlerin günlük arşivlerini tutar.

| Alan Adı | Veri Tipi | Açıklama |
| :--- | :--- | :--- |
| `id` | INTEGER | Birincil Anahtar |
| `store_id` | INTEGER | `stores` tablosuna referans |
| `type` | TEXT | 'cargo' (Kargo) veya 'cancel' (İptal) |
| `entry_date` | TEXT | Kayıt tarihi (YYYY-MM-DD formatında) |
| `data` | TEXT | Tablo verisinin tamamını içeren JSON string |
| `created_at` | DATETIME | Oluşturulma zamanı |

### 2.6. `orders` (Siparişler)
Siparişlerin yaşam döngüsünü takip etmek için tasarlanmıştır (Geliştirme aşamasında).

| Alan Adı | Veri Tipi | Açıklama |
| :--- | :--- | :--- |
| `id` | INTEGER | Birincil Anahtar |
| `store_id` | INTEGER | Mağaza referansı |
| `order_number` | TEXT | Sipariş Numarası |
| `status` | TEXT | Sipariş Durumu (waiting, preparing vb.) |
| `order_data` | TEXT | Detaylı sipariş verisi (JSON) |
| ... | ... | (Diğer alanlar şemada tanımlıdır) |

---

## 3. Sorgular ve IPC İşleyicileri (Handlers)

Uygulama, `renderer.js`'den gelen istekleri `main.js` içindeki aşağıdaki işleyicilerle karşılar.

### Mağaza İşlemleri
*   **Mağaza Ekle** (`db-add-store`):
    ```sql
    INSERT INTO stores (name) VALUES (?)
    ```
*   **Mağazaları Getir** (`db-get-stores`):
    ```sql
    SELECT * FROM stores ORDER BY name ASC
    ```
*   **Entegrasyon Güncelle** (`db-update-store-integration`):
    ```sql
    UPDATE stores SET api_key = ?, api_secret = ?, seller_id = ? WHERE id = ?
    ```
*   **Mağaza Sil** (`db-delete-store`):
    ```sql
    DELETE FROM stores WHERE id = ?
    ```

### Ürün İşlemleri
*   **Ürün Ekle** (`db-add-product`):
    ```sql
    INSERT INTO products (store_id, name, barcode) VALUES (?, ?, ?)
    ```
*   **Ürünleri Getir** (`db-get-products`):
    ```sql
    SELECT * FROM products WHERE store_id = ? ORDER BY id DESC
    ```
*   **Ürün Güncelle** (`db-update-product`):
    ```sql
    UPDATE products SET name = ?, barcode = ? WHERE id = ?
    ```

### Arşiv ve Günlük Kayıt İşlemleri
*   **Günlük Kayıt Ekle** (`param-add-daily-entry`):
    ```sql
    INSERT INTO daily_entries (store_id, type, entry_date, data) VALUES (?, ?, ?, ?)
    ```
*   **Günlük Kayıtları Getir** (`param-get-daily-entries`):
    ```sql
    SELECT * FROM daily_entries WHERE entry_date = ? AND store_id = ? AND type = ? ORDER BY id DESC
    ```
*   **Kaydı Güncelle** (`param-update-daily-entry`):
    ```sql
    UPDATE daily_entries SET data = ? WHERE id = ?
    ```

### Excel / Veri İçe Aktarma İşlemleri
*   **Veri Kaydet** (`save-excel-data`):
    *   Önce `import_batches` tablosuna kayıt atılır.
    *   Ardından döngü ile `imported_data` tablosuna satırlar eklenir.
    *   İşlem `TRANSACTION` bloğu içinde güvenli bir şekilde yapılır.

## 4. Migrations (Otomatik Güncellemeler)
Uygulama her başladığında `performMigrations()` fonksiyonu çalışır. Bu fonksiyon, eksik sütunları (örn. `api_secret`, `created_at`) kontrol eder ve `ALTER TABLE` komutları ile veritabanını günceller. Bu sayede veri kaybı olmadan yapısal değişiklikler uygulanır.
