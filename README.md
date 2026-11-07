# EkoZeka2026 · Gerçek mi, Yapay mı?

CSAI topluluğunun iklim ve çevre temalı yarışması için canlı oyun. Dev ekranda görsel açılır, herkes telefonundan QR ile girip oylar.
Herkes oyladığında (ya da süre bitince) cevap ve salonun oranları anında ekranda görünür.

## Çalıştırma

```
npm install
npm start
```

Konsol iki adres yazar:

- **Dev ekran:** `/host` Bunu projeksiyondaki bilgisayarda aç ve şifreyi gir (`ADMIN_PASSWORD`). Şifre o sekme kapanana kadar hatırlanır.
- **Oyuncular:** Dev ekrandaki QR kod bu adrese gider.

Dev ekran kısayolları: `Boşluk` bir sonraki adım, `F` tam ekran. Lobide bir takma ada tıklamak onu oyundan çıkarır.

## Görseller

Görselleri `images/gercek/` ve `images/yapay/` klasörlerine at (jpg, png, webp). Cevap, dosyanın bulunduğu klasörden gelir.
Aynı adla bir `.txt` eklersen (`buzul.jpg` + `buzul.txt`) cevap ekranında çıkar:

```
Chugach Eyalet Parkı'nda bir buzul, Alaska      <- başlık (neyin fotoğrafı)
Alaska'daki bir buzulun üstten görünümü...      <- açıklama
Foto: Ad Soyad · CC BY-SA 4.0                   <- kaynak (isteğe bağlı, "Foto:" ile başlar)
```

Yeni görseller bir sonraki oyunda devreye girer, sunucuyu yeniden başlatmak gerekmez.

- Görselleri en fazla 1280-1600 px yap. Salondaki herkes aynı anda indirecek.
- Metadata'yı temizle. Birçok üretim aracı EXIF'e kendi adını yazar ve meraklı biri bunu okuyabilir.
- Başlangıç setinin kaynak ve lisansları `images/KAYNAKLAR.md` dosyasında. CC BY-SA ve GFDL lisanslı görselleri yayımlıyorsan bu atıflar kalmalı.

## Ayarlar (ortam değişkenleri)

| Değişken | Varsayılan | Açıklama |
|---|---|---|
| `PORT` | 3000 | Sunucu portu |
| `ADMIN_PASSWORD` | her açılışta rastgele (konsola yazılır) | Dev ekran şifresi. Yayında mutlaka kendin belirle |
| `ROUND_SECONDS` | 20 | Tur süresi |
| `QUESTION_COUNT` | hepsi | Kaç görsel sorulacak |
| `PUBLIC_URL` | otomatik | QR kodun gideceği adres |

## Herkes nasıl bağlanacak?

QR adresi, dev ekranı hangi adresten açtıysan ona göre otomatik oluşur.

- **Aynı Wi-Fi:** `npm start` yeterli. Ancak kampüs ve etkinlik ağları cihazların birbirini görmesini çoğu zaman engeller, önceden telefonla dene.
- **Tünel:** `cloudflared tunnel --url http://localhost:3000` herkese açık bir https adresi verir. Dev ekranı bu adresten aç.
- **Bulut (Render, Railway vb.):** GitHub deposunu bağla. Build komutu `npm install`, başlatma komutu `npm start`. `ADMIN_PASSWORD` değişkenini tanımla. WebSocket destekleyen tek bir sunucu örneği kullan.
- **Vercel / Netlify çalışmaz:** Sunucusuz (serverless) oldukları için sürekli açık WebSocket bağlantısı ve bellekteki oyun durumu tutulamaz.

## Bilinmesi gerekenler

- Oyun durumu bellektedir. Sunucu yeniden başlarsa skorlar sıfırlanır, oyun sırasında dağıtım yapma.
- Bağlantısı kopan veya telefonu kilitlenen kişi beklenmez, geri geldiğinde kaldığı yerden devam eder.
- Sıralamada eşitlik, doğru cevaplardaki toplam süreyle bozulur.
