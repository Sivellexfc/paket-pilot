
1. "Batch" (Parti) Mantığına Geçiş
Satıcı her "Hazırlamaya Başla" ve "Bitir" döngüsünü tamamladığında, bu işlemleri bir Batch ID altında grupla.

Sorun: Eğer satıcı sabah 10:00'da 50 paket gönderdiyse ve 11:00'de tekrar "Hazırlamaya Başla" derse, Trendyol API'si o 50 paketi hala "Hazırlanıyor" olarak döndüreceği için senin listen şişecek.

Çözüm: Bir sipariş "Kargo Durumları" tablosuna girilip arşive alındığı an, o siparişi aktif "Hazırlanacaklar" listesinden filtrele. Yani sistem Trendyol'dan listeyi çekmeli ama veritabanında "Kargoya Verildi/Arşivlendi" statüsünde olan order_number'ları bu listede göstermemeli.

***2."Gölge Hazırlanıyor" Statüsü
Trendyol tarafında statü değişene kadar geçen süreyi yönetmek için kendi veritabanında bir ara statü kullanmalısın:

Hazırlanıyor: Trendyol'dan gelen ham liste.

Kargoya Teslim Edildi (Sizin Sisteminizde): Satıcı adetleri girip onayladıktan sonraki aşama.

Trendyol Onaylı Kargo: Trendyol API'sinden o siparişin statüsünün gerçekten Shipped (Kargolandı) geldiği aşama.

Bu sayede satıcı öğleden sonra tekrar listeyi çektiğinde, sabah kargoya verdiği ürünler Trendyol'da hala "Hazırlanıyor" olsa bile, senin sistemin "Ben bunu zaten kargoya teslim ettim" diyerek listeye dahil etmez.

3. İptal Yönetimi ve "Yolda İptal" Kontrolü
Bahsettiğin "Kargodaki İptal" durumu için günde bir kez toplu kontrol yapmak yerine şunu yapabilirsin:

Satıcı "Kargoyu Hazırla" dediği an, sistem arka planda son 24-48 saatte "Kargoya Verildi" olarak işaretlediğin ama Trendyol'da hala "Kargolandı" statüsüne geçmemiş tüm siparişleri Trendyol İptal API'si ile sorgular.

Eğer kargoya verdiğin bir ürün iptal listesindeyse, ekrana bir "Kritik Uyarı" düşürürsün: "Dikkat: Aşağıdaki paketler kargoya verildi işaretlendi ancak kurye okutmadan önce müşteri iptal etti. Kargo şubesinden bu paketleri geri çekin!"