# Tek Mağaza Per Pencere Mimarisi - Uygulama Özeti

## Yapılan Değişiklikler

### 1. Yeni Dosyalar
- **store-selector.html**: Mağaza seçim ekranı
- **store-selector.js**: Mağaza seçim ekranı mantığı

### 2. Ana Değişiklikler

#### main.js
- `mainWindow` yerine `selectorWindow` ve `storeWindows` Map yapısı
- `createSelectorWindow()`: Uygulama başlangıcında mağaza seçim ekranını açar
- `createStoreWindow(storeId)`: Seçilen mağaza için yeni pencere açar
- Yeni IPC handlers:
  - `open-store-window`: Belirli bir mağaza için pencere açar
  - `get-opened-stores`: Açık mağazaların listesini döner
  - `notify-stores-updated`: Tüm pencerelere mağaza güncellemelerini bildirir

#### renderer.js
- `initializeStoreLogic()`: Artık main process'ten gelen store ID'yi dinler
- Sidebar gizlenir (tek mağaza modu)
- `renderSidebarStores()` ve `switchStore()` fonksiyonları devre dışı bırakıldı

#### stores.js
- Mağaza eklendiğinde/silindiğinde/güncellendiğinde tüm pencerelere bildirim gönderir

## Kullanım Akışı

1. **Uygulama Başlatma**
   - Uygulama açıldığında mağaza seçim ekranı gösterilir
   - Kullanıcı kayıtlı mağazaları görür

2. **Mağaza Seçimi**
   - Kullanıcı bir mağaza seçer
   - O mağaza için yeni bir pencere açılır
   - Pencere sadece o mağaza için çalışır

3. **Çoklu Mağaza**
   - Kullanıcı farklı bir mağaza seçerse, yeni bir pencere açılır
   - Aynı mağaza birden fazla pencerede açılamaz
   - Açık mağazalar "Açık" badge'i ile işaretlenir

4. **Mağaza Yönetimi**
   - Mağaza seçim ekranından yeni mağaza eklenebilir
   - Stores.html'den mağazalar düzenlenebilir/silinebilir
   - Tüm değişiklikler otomatik olarak tüm pencerelere yansır

## Özellikler

✅ Her pencere tek bir mağaza için çalışır
✅ Aynı mağaza birden fazla pencerede açılamaz
✅ Kullanıcı istediği kadar farklı mağaza için pencere açabilir
✅ Mağaza değişiklikleri tüm pencerelere otomatik yansır
✅ Modern, kullanıcı dostu mağaza seçim ekranı
✅ Açık mağazalar görsel olarak işaretlenir

## Teknik Detaylar

### IPC İletişimi
- `set-store-id`: Main process'ten renderer'a store ID gönderir
- `open-store-window`: Yeni mağaza penceresi açar
- `get-opened-stores`: Açık mağazaların listesini alır
- `notify-stores-updated`: Mağaza güncellemelerini bildirir

### Pencere Yönetimi
- `storeWindows` Map: storeId -> BrowserWindow
- Her pencere kapandığında Map'ten otomatik temizlenir
- Selector window tüm store window'lar kapanınca uygulamayı kapatır

### Veri İzolasyonu
- Her pencere kendi mağazasının verilerini yönetir
- Sidebar gizlenir (tek mağaza modu)
- Store ID renderer'a otomatik gönderilir
