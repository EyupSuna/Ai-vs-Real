# EkoZeka2026 · Gerçek mi, Yapay mı?

CSAI topluluğunun iklim ve çevre temalı yarışması için canlı oyun. Dev ekranda görsel açılır, herkes telefonundan QR ile girip oylar.
Herkes oyladığında (ya da süre bitince) cevap ve salonun oranları anında ekranda görünür.

## Çalıştırma

```
npm install
npm start
```

Konsol iki adres yazar:

- **Dev ekran:** `/host` Bunu projeksiyondaki bilgisayarda aç ve şifreyi gir. Şifre o sekme kapanana kadar hatırlanır.
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

Bilgisayarda yeni görseller bir sonraki oyunda devreye girer. Vercel'de GitHub'a push edip yeni deploy'u beklemek gerekir.

- Görselleri en fazla 1280-1600 px yap. Salondaki herkes aynı anda indirecek.
- Metadata'yı temizle. Birçok üretim aracı EXIF'e kendi adını yazar ve meraklı biri bunu okuyabilir.
- Başlangıç setinin kaynak ve lisansları `images/KAYNAKLAR.md` dosyasında. CC BY-SA ve GFDL lisanslı görselleri yayımlıyorsan bu atıflar kalmalı.

## Vercel'de yayınlama

Oyun sunucusuz çalışır: telefonlar her saniye durumu sorar, oylar ve skorlar Upstash Redis'te tutulur.

1. Projeyi GitHub'a push et ve Vercel'de **Add New → Project** ile depoyu içe aktar. Framework Preset **Other** kalsın; diğer ayarlar `vercel.json`'dan gelir.
2. **Storage** sekmesi → **Create Database / Marketplace** → **Upstash for Redis** → ücretsiz plan → projeye bağla. Bağlantı bilgileri ortam değişkeni olarak kendiliğinden eklenir.
3. **Deployments** sekmesinden son deploy'u **Redeploy** et. Veritabanı bağlantısı ancak yeni deploy'la devreye girer.

Sonra dev ekran `https://<proje>.vercel.app/host`, katılımcı adresi `https://<proje>.vercel.app` olur.

- Dev ekran sekmesi oyun boyunca açık kalmalı: süreyi dolduran ve cevabı açan odur.
- Upstash'in ücretsiz planı aylık sınırlıdır. 300 kişilik, 25 görsellik bir oyun yaklaşık 50-100 bin komut harcar; prova ve etkinlik için yeter.

## Dev ekran şifresi

Şifre koda gömülüdür (`lib/game.js` içindeki `ADMIN_HASH`). Depo herkese açık olduğu için şifrenin kendisi değil SHA-256 özeti durur.
Değiştirmek için yeni şifrenin özetini al ve `ADMIN_HASH`'e yapıştır:

```
node -e "console.log(require('crypto').createHash('sha256').update('YENI_SIFRE').digest('hex'))"
```

## Ayarlar (ortam değişkenleri)

| Değişken | Varsayılan | Açıklama |
|---|---|---|
| `ADMIN_PASSWORD` | yok | Verilirse koda gömülü şifrenin yerine geçer (isteğe bağlı) |
| `ROUND_SECONDS` | 20 | Tur süresi |
| `QUESTION_COUNT` | hepsi | Kaç görsel sorulacak |
| `PUBLIC_URL` | otomatik | QR kodun gideceği adres |
| `ONLINE_SECONDS` | 30 | Bu süre ses vermeyen telefon "ayrıldı" sayılır, beklenmez |
| `PORT` | 3000 | Yalnızca bilgisayarda: sunucu portu |

## Bilgisayardan oynatma (Vercel'siz)

`npm start` aynı oyunu tek sunucuda çalıştırır; Redis gerekmez, durum bellekte tutulur.

- **Aynı Wi-Fi:** Kampüs ve etkinlik ağları cihazların birbirini görmesini çoğu zaman engeller, önceden telefonla dene.
- **Tünel:** `cloudflared tunnel --url http://localhost:3000` herkese açık bir https adresi verir. Dev ekranı bu adresten aç.

## Bilinmesi gerekenler

- Cevap, herkes oyladıktan en geç 1-2 saniye sonra açılır (telefonlar saniyede bir sorar).
- Telefonu kilitlenen kişi en geç `ONLINE_SECONDS` sonra beklenmez; geri geldiğinde kaldığı yerden devam eder.
- Sıralamada eşitlik, doğru cevaplardaki toplam süreyle bozulur.
- Oyun sırasında yeni deploy yapma; açık sayfalar eski koda bakar.
