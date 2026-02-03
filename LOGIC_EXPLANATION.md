
# Kargo Onay Mantığı

Sorduğunuz soruya cevaben:

**Evet, sistem tam olarak dediğiniz şekilde çalışıyor.**

"Kargolar Kargoya Verildi" butonuna bastığınızda:
1.  O anki listenin (Hazırlanmayı Bekleyen Siparişler) bir kopyası alınıyor.
2.  İptal edilen siparişler bu listeden çıkarılıyor.
3.  Kalan her satırın en sonuna **"Kargo Durumu"** isminde yeni bir kolon ekleniyor.
4.  Bu kolonun değeri her sipariş için **"Kargoya Verildi"** olarak ayarlanıyor.
5.  Oluşan bu son tablo veritabanına (Kargo Arşivi) kaydediliyor.
