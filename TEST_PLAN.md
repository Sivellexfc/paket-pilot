# Test Planı - Tek Mağaza Per Pencere

## Test Senaryoları

### 1. İlk Başlatma
**Adımlar:**
1. Uygulamayı başlat
2. Mağaza seçim ekranının açıldığını doğrula
3. Eğer mağaza yoksa "Henüz Mağaza Yok" mesajını görmelisin

**Beklenen Sonuç:**
- Mağaza seçim ekranı gradient arka planla açılır
- Logo ve başlık görünür
- Mağazalar grid layout'ta listelenir

### 2. Yeni Mağaza Ekleme
**Adımlar:**
1. "Yeni Mağaza Ekle" butonuna tıkla
2. Modal açılır
3. Mağaza adı gir (örn: "Test Mağazası")
4. "Kaydet" butonuna tıkla

**Beklenen Sonuç:**
- Modal kapanır
- Yeni mağaza listede görünür
- Mağaza kartı tıklanabilir durumda

### 3. Mağaza Penceresi Açma
**Adımlar:**
1. Bir mağaza kartına tıkla
2. "Bu Mağaza İçin Aç" butonuna tıkla

**Beklenen Sonuç:**
- Yeni bir pencere açılır
- Pencere başlığında mağaza adı görünür
- Sidebar gizlidir
- Ana uygulama yüklenir

### 4. Aynı Mağazayı Tekrar Açmaya Çalışma
**Adımlar:**
1. Zaten açık bir mağaza için tekrar "Aç" butonuna tıkla

**Beklenen Sonuç:**
- Yeni pencere açılmaz
- Mevcut pencere öne gelir (focus)
- Mağaza kartında "Zaten Açık" badge'i görünür

### 5. Farklı Mağazalar İçin Çoklu Pencere
**Adımlar:**
1. İlk mağaza için pencere aç
2. Mağaza seçim ekranına dön
3. Farklı bir mağaza için pencere aç

**Beklenen Sonuç:**
- Her iki pencere de açık kalır
- Her pencere kendi mağazası için çalışır
- Mağaza seçim ekranında her iki mağaza "Açık" olarak işaretlenir

### 6. Pencere Kapatma
**Adımlar:**
1. Bir mağaza penceresini kapat
2. Mağaza seçim ekranına dön

**Beklenen Sonuç:**
- Kapatılan mağaza artık "Açık" olarak işaretlenmez
- Mağaza tekrar açılabilir hale gelir
- Diğer açık pencereler etkilenmez

### 7. Tüm Pencereleri Kapatma
**Adımlar:**
1. Tüm mağaza pencerelerini kapat
2. Mağaza seçim penceresini kapat

**Beklenen Sonuç:**
- Uygulama tamamen kapanır

### 8. Mağaza Yönetimi
**Adımlar:**
1. Bir mağaza penceresinde "Mağazalar Yönetimi" butonuna tıkla (eğer görünürse)
2. Veya mağaza seçim ekranından stores.html'i aç

**Beklenen Sonuç:**
- Mağaza yönetim penceresi açılır
- Mağazalar düzenlenebilir/silinebilir
- Değişiklikler tüm pencerelere yansır

## Bilinen Sınırlamalar

1. Sidebar her mağaza penceresinde gizlidir (tek mağaza modu)
2. Mağaza değiştirmek için yeni pencere açılmalı
3. Her pencere bağımsız çalışır

## Hata Durumları

### Mağaza Bulunamadı
- Eğer store ID geçersizse "Mağaza Bulunamadı" görünümü gösterilir

### Veritabanı Hatası
- Hata konsola loglanır
- Kullanıcıya uygun hata mesajı gösterilir

## Performans Notları

- Her pencere ayrı Electron renderer process kullanır
- Çok sayıda pencere açmak sistem kaynaklarını tüketebilir
- Önerilen maksimum: 5-10 mağaza penceresi
