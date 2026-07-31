// Vercel Edge Middleware.
// Tujuan: saat link ini dibuka oleh BOT pembuat thumbnail (WhatsApp, Telegram,
// Facebook, dll), balas dengan HTML kecil berisi judul & deskripsi TERBARU
// yang diambil langsung dari Supabase (sesuai isian admin panel).
// Untuk pengunjung manusia biasa, middleware ini tidak melakukan apa-apa —
// permintaan diteruskan ke aplikasi React seperti biasa.

export const config = { matcher: "/" };

const BOT_UA_REGEX =
  /facebookexternalhit|Facebot|Twitterbot|WhatsApp|TelegramBot|LinkedInBot|Slackbot|Discordbot|Pinterest|SkypeUriPreview|line-poker|vkShare|Google-InspectionTool|W3C_Validator/i;

const CONFIG_KEY = "assessment-config";

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

export default async function middleware(request) {
  const ua = request.headers.get("user-agent") || "";
  if (!BOT_UA_REGEX.test(ua)) {
    return; // bukan bot preview -> lanjut ke SPA seperti biasa
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY;

  let title = "Asesmen Presentasi Virtual";
  let description = "Isi asesmen singkat ini.";

  try {
    const res = await fetch(
      `${supabaseUrl}/rest/v1/kv_store?key=eq.${CONFIG_KEY}&shared=eq.true&select=value`,
      { headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` } }
    );
    const rows = await res.json();
    if (Array.isArray(rows) && rows[0] && rows[0].value) {
      const cfg = JSON.parse(rows[0].value);
      if (cfg.title) title = cfg.title;
      if (cfg.subtitle) description = cfg.subtitle;
    }
  } catch (e) {
    // gagal ambil dari Supabase -> pakai judul default di atas, tidak error ke user
  }

  const html = `<!doctype html>
<html lang="id">
<head>
<meta charset="UTF-8" />
<title>${escapeHtml(title)}</title>
<meta property="og:title" content="${escapeHtml(title)}" />
<meta property="og:description" content="${escapeHtml(description)}" />
<meta property="og:type" content="website" />
<meta name="twitter:card" content="summary" />
<meta name="twitter:title" content="${escapeHtml(title)}" />
<meta name="twitter:description" content="${escapeHtml(description)}" />
</head>
<body></body>
</html>`;

  return new Response(html, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}
