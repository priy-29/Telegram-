// File: bot.js (Versi Ditingkatkan - Aman & Stabil)

const TelegramBot = require('node-telegram-bot-api');
const admin = require('firebase-admin');

// --- KONFIGURASI AMAN (Menggunakan Environment Variables) ---
// JANGAN PERNAH MENULIS TOKEN ATAU KUNCI LANGSUNG DI SINI
// Variabel ini akan diisi oleh hosting (seperti Render) saat deployment.

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const ADMIN_USER_ID = parseInt(process.env.ADMIN_USER_ID, 10); // Pastikan ini adalah angka

// Kredensial Firebase diambil dari satu environment variable yang berisi seluruh JSON
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);

// --- VALIDASI KONFIGURASI ---
if (!TELEGRAM_TOKEN || !ADMIN_USER_ID || !serviceAccount) {
    console.error("Kesalahan: Variabel lingkungan (TELEGRAM_TOKEN, ADMIN_USER_ID, FIREBASE_SERVICE_ACCOUNT_JSON) belum diatur!");
    process.exit(1); // Hentikan bot jika konfigurasi penting tidak ada
}

// --- INISIALISASI ---
try {
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    console.log("Koneksi ke Firebase Firestore berhasil.");
} catch (error) {
    console.error("Gagal koneksi ke Firebase:", error);
    process.exit(1);
}
const db = admin.firestore();
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

// Objek untuk menyimpan state percakapan sementara
const userState = {};

// Daftar item untuk menu dinamis
const PAYMENT_METHODS = {
    dana: "Dana", gopay: "GoPay", ovo: "OVO", bca: "BCA", qris: "QRIS"
};
const SOCIAL_MEDIA = {
    instagram: "Instagram", facebook: "Facebook", telegram: "Telegram", whatsapp: "WhatsApp",
    youtube: "YouTube", tiktok: "TikTok", twitter: "Twitter (X)", linkedin: "LinkedIn"
};

// --- FUNGSI PEMBANTU ---

// Fungsi untuk memeriksa apakah pengguna adalah admin
const isAdmin = (userId) => userId === ADMIN_USER_ID;

// Membuat keyboard menu dinamis
const generateMenuKeyboard = (items, collectionPrefix) => {
    const keyboard = Object.entries(items).map(([id, name]) => {
        return [{ text: name, callback_data: `view_${collectionPrefix}_${id}` }];
    });
    keyboard.push([{ text: "« Kembali ke Menu Utama", callback_data: "menu_main" }]);
    return { reply_markup: { inline_keyboard: keyboard } };
};

// Mengirim atau mengedit pesan untuk menampilkan menu utama
const sendMainMenu = (chatId, messageId) => {
    const text = "Selamat datang, Admin! Pilih menu untuk mengelola konten website:";
    const options = {
        reply_markup: {
            inline_keyboard: [
                [{ text: "💳 Kelola Pembayaran", callback_data: "menu_pembayaran" }],
                [{ text: "⭐ Kelola Testimoni", callback_data: "menu_testimoni" }],
                [{ text: "🔗 Kelola Akun Sosial", callback_data: "menu_sosial" }],
            ]
        }
    };

    if (messageId) {
        bot.editMessageText(text, { chat_id: chatId, message_id: messageId, ...options }).catch(err => {
            // Jika gagal mengedit (misal, pesan terlalu lama), kirim pesan baru
            if (err.response && err.response.statusCode === 400) {
                bot.sendMessage(chatId, text, options);
            }
        });
    } else {
        bot.sendMessage(chatId, text, options);
    }
};

// --- HANDLER UTAMA ---

// Handler untuk perintah /start atau /batal
bot.onText(/\/start|\/batal/, (msg) => {
    if (!isAdmin(msg.from.id)) {
        return bot.sendMessage(msg.chat.id, "⛔ Anda tidak diizinkan menggunakan bot ini.");
    }
    delete userState[msg.chat.id]; // Hapus state percakapan yang sedang berjalan
    sendMainMenu(msg.chat.id);
});

// Handler untuk semua interaksi tombol (Callback Query)
bot.on('callback_query', async (callbackQuery) => {
    const msg = callbackQuery.message;
    const chatId = msg.chat.id;

    if (!isAdmin(callbackQuery.from.id)) {
        return bot.answerCallbackQuery(callbackQuery.id, { text: "Akses ditolak.", show_alert: true });
    }

    bot.answerCallbackQuery(callbackQuery.id); // Hapus status "loading" pada tombol

    const [action, collection, docId] = callbackQuery.data.split('_');

    try {
        // --- NAVIGASI MENU ---
        if (action === 'menu') {
            if (collection === 'main') {
                return sendMainMenu(chatId, msg.message_id);
            }
            if (collection === 'pembayaran' || collection === 'sosial') {
                const menuItems = collection === 'pembayaran' ? PAYMENT_METHODS : SOCIAL_MEDIA;
                const menuTitle = collection === 'pembayaran' ? "Pilih metode pembayaran untuk dikelola:" : "Pilih akun sosial untuk dikelola:";
                return bot.editMessageText(menuTitle, {
                    chat_id: chatId, message_id: msg.message_id, ...generateMenuKeyboard(menuItems, collection)
                });
            }
            if (collection === 'testimoni') {
                const keyboard = [
                    [{ text: "➕ Tambah Testimoni Baru", callback_data: "add_testimoni_new" }],
                    [{ text: "« Kembali ke Menu Utama", callback_data: "menu_main" }]
                ];
                return bot.editMessageText("Pilih aksi untuk testimoni:", {
                    chat_id: chatId, message_id: msg.message_id,
                    reply_markup: { inline_keyboard: keyboard }
                });
            }
        }

        // --- AKSI CRUD (Create, Read, Update, Delete) ---
        const docRef = db.collection(collection).doc(docId);

        if (action === 'view') {
            const doc = await docRef.get();
            const platformName = (PAYMENT_METHODS[docId] || SOCIAL_MEDIA[docId] || docId).toUpperCase();
            let text = `Mengelola: *${platformName}*\n\n`;
            let keyboard = [];

            if (doc.exists) {
                const data = doc.data();
                text += "Data saat ini:\n";
                if (collection === 'pembayaran' && docId === 'qris') {
                    text += `Link Gambar: [Lihat Disini](${data.gambar_qris})`;
                } else if (collection === 'pembayaran') {
                    text += `Nomor: \`${data.nomor || data.nomor_rekening}\`\n`;
                    text += `Pemilik: \`${data.pemilik || data.nama_pemilik}\``;
                } else if (collection === 'sosial') {
                    text += `Link: \`${data.link}\``;
                }
                keyboard = [
                    [{ text: "🔄 Perbarui", callback_data: `edit_${collection}_${docId}` }],
                    [{ text: "❌ Hapus", callback_data: `delete_${collection}_${docId}` }]
                ];
            } else {
                text += "Data belum ada di database.";
                keyboard = [[{ text: "➕ Tambahkan", callback_data: `add_${collection}_${docId}` }]];
            }
            keyboard.push([{ text: "« Kembali", callback_data: `menu_${collection}` }]);
            return bot.editMessageText(text, {
                chat_id: chatId, message_id: msg.message_id, parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: keyboard }
            });
        }
        
        if (action === 'add' || action === 'edit') {
            userState[chatId] = { action, collection, docId };
            const platformName = (PAYMENT_METHODS[docId] || SOCIAL_MEDIA[docId] || "Testimoni").toUpperCase();
            
            if (docId === 'qris') {
                bot.sendMessage(chatId, `Silakan kirim gambar Kode QRIS yang baru untuk ${platformName}.`);
                userState[chatId].step = 'get_qris_photo';
            } else if (collection === 'pembayaran') {
                bot.sendMessage(chatId, `Masukkan nomor baru untuk ${platformName}:`);
                userState[chatId].step = 'get_payment_nomor';
            } else if (collection === 'sosial') {
                bot.sendMessage(chatId, `Masukkan link baru untuk ${platformName}:`);
                userState[chatId].step = 'get_social_link';
            } else if (collection === 'testimoni') {
                 bot.sendMessage(chatId, "Silakan kirim foto untuk testimoni baru:");
                 userState[chatId].step = 'get_testimoni_photo';
            }
        }
        
        if (action === 'delete') {
            await docRef.delete();
            const platformName = (PAYMENT_METHODS[docId] || SOCIAL_MEDIA[docId] || docId).toUpperCase();
            await bot.editMessageText(`✅ Data *${platformName}* berhasil dihapus.`, {
                chat_id: chatId, message_id: msg.message_id, parse_mode: 'Markdown'
            });
            setTimeout(() => sendMainMenu(chatId), 1500); // Kembali ke menu utama setelah 1.5 detik
        }

    } catch (error) {
        console.error(`Error di on('callback_query') - Data: ${callbackQuery.data}`, error);
        bot.sendMessage(chatId, "Terjadi kesalahan internal saat memproses permintaan Anda.");
    }
});

// Handler untuk input teks (hanya jika ada state)
bot.on('text', async (msg) => {
    const chatId = msg.chat.id;
    const state = userState[chatId];

    // Abaikan jika bukan admin, tidak ada state, atau itu adalah sebuah perintah
    if (!isAdmin(chatId) || !state || msg.text.startsWith('/')) return;
    
    const text = msg.text;

    try {
        switch (state.step) {
            case 'get_payment_nomor':
                state.nomor = text;
                bot.sendMessage(chatId, `Nomor disimpan. Masukkan nama pemilik (a.n.) untuk ${state.docId.toUpperCase()}:`);
                state.step = 'get_payment_pemilik';
                break;
            case 'get_payment_pemilik':
                await db.collection(state.collection).doc(state.docId).set({
                    tipe: state.docId,
                    [state.docId === 'bca' ? 'nomor_rekening' : 'nomor']: state.nomor,
                    [state.docId === 'bca' ? 'nama_pemilik' : 'pemilik']: text
                }, { merge: true });
                bot.sendMessage(chatId, `✅ Data ${state.docId.toUpperCase()} berhasil diperbarui!`);
                delete userState[chatId];
                setTimeout(() => sendMainMenu(chatId), 1000);
                break;

            case 'get_social_link':
                await db.collection(state.collection).doc(state.docId).set({
                    nama: SOCIAL_MEDIA[state.docId] || state.docId.toUpperCase(),
                    link: text
                }, { merge: true });
                bot.sendMessage(chatId, `✅ Link untuk ${state.docId.toUpperCase()} berhasil diperbarui!`);
                delete userState[chatId];
                setTimeout(() => sendMainMenu(chatId), 1000);
                break;
            
            case 'get_testimoni_nama':
                state.nama = text;
                bot.sendMessage(chatId, `Nama disimpan. Masukkan isi testimoni dari ${text}:`);
                state.step = 'get_testimoni_isi';
                break;
            case 'get_testimoni_isi':
                await db.collection('testimoni').add({
                    nama: state.nama,
                    isi: text,
                    foto: state.foto_link,
                    tanggal: admin.firestore.FieldValue.serverTimestamp() // Cara yang benar untuk timestamp
                });
                bot.sendMessage(chatId, `🎉 Testimoni dari ${state.nama} berhasil ditambahkan!`);
                delete userState[chatId];
                setTimeout(() => sendMainMenu(chatId), 1000);
                break;
        }
    } catch (error) {
        console.error(`Error di on('text') - Step: ${state.step}`, error);
        bot.sendMessage(chatId, "Gagal menyimpan data. Silakan coba lagi.");
        delete userState[chatId];
    }
});

// Handler untuk foto (hanya jika ada state)
bot.on('photo', async (msg) => {
    const chatId = msg.chat.id;
    const state = userState[chatId];

    // Abaikan jika bukan admin atau tidak ada state
    if (!isAdmin(chatId) || !state) return;

    const fileId = msg.photo[msg.photo.length - 1].file_id;

    try {
        const fileLink = await bot.getFileLink(fileId);

        if (state.step === 'get_qris_photo') {
            await db.collection('pembayaran').doc('qris').set({
                tipe: 'qris', gambar_qris: fileLink
            }, { merge: true });
            bot.sendMessage(chatId, "✅ Gambar QRIS berhasil diperbarui!");
            delete userState[chatId];
            setTimeout(() => sendMainMenu(chatId), 1000);
        }
        else if (state.step === 'get_testimoni_photo') {
            state.foto_link = fileLink;
            bot.sendMessage(chatId, "✅ Foto diterima. Sekarang, masukkan nama pelanggan:");
            state.step = 'get_testimoni_nama';
        }
    } catch (error) {
        console.error(`Error di on('photo') - Step: ${state.step}`, error);
        bot.sendMessage(chatId, "Gagal memproses foto. Silakan coba lagi.");
        delete userState[chatId];
    }
});

console.log("Bot Cerdas (Versi Ditingkatkan) sedang berjalan...");

