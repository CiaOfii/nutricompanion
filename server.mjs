import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const API_KEY = (process.env.GEMINI_API_KEY || '').trim();
const MODELS = (process.env.GEMINI_MODELS || 'gemini-3.8-flash,gemini-3.5-flash,gemini-3.1-flash-lite')
  .split(',').map(s => s.trim()).filter(Boolean);
const MAX_BODY = 1024 * 1024;

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml'
};

function send(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(JSON.stringify(payload));
}

async function readJson(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (Buffer.byteLength(raw, 'utf8') > MAX_BODY) {
      throw Object.assign(new Error('Pesan terlalu besar.'), { status: 413 });
    }
  }
  try { return JSON.parse(raw || '{}'); }
  catch { throw Object.assign(new Error('Format permintaan tidak valid.'), { status: 400 }); }
}

function friendlyGeminiError(status, message) {
  const m = String(message || '');
  if (/API_KEY_INVALID|API key not valid|invalid api key/i.test(m)) return 'API key Gemini tidak valid. Buat API key baru dan atur GEMINI_API_KEY di Environment Variables hosting atau file .env lokal.';
  if (status === 401 || status === 403) return `Google menolak akses (HTTP ${status}). Periksa API key, akses Gemini API, dan kuota/billing project Google AI Studio. Detail: ${m.slice(0, 220)}`;
  if (status === 404) return `Model Gemini tidak tersedia untuk API key ini. Model yang dicoba: ${MODELS.join(', ')}. Pilih model yang mendukung generateContent. Detail: ${m.slice(0, 220)}`;
  if (status === 429) return `Batas penggunaan Gemini tercapai (HTTP 429). Periksa kuota dan batas permintaan pada Google AI Studio. Detail: ${m.slice(0, 220)}`;
  if ([500, 502, 503, 504].includes(status)) return `Layanan Gemini gagal merespons (HTTP ${status}). Coba lagi nanti. Detail: ${m.slice(0, 220)}`;
  if (status === 0 || status === 502) return `Backend tidak berhasil terhubung ke Gemini. Periksa koneksi internet server dan konfigurasi API. Detail: ${m.slice(0, 220)}`;
  return `Gemini gagal merespons (HTTP ${status || 'tidak diketahui'}). ${m.slice(0, 250)}`;
}

async function handleChat(req, res) {
  if (!API_KEY) {
    return send(res, 500, { error: 'API key belum dikonfigurasi. Isi GEMINI_API_KEY di file .env lokal atau Environment Variables pada hosting.' });
  }

  const body = await readJson(req);
  if (!Array.isArray(body.contents) || body.contents.length === 0) {
    return send(res, 400, { error: 'Pesan percakapan kosong. Silakan ketik pertanyaan terlebih dahulu.' });
  }

  let contents;
  try {
    contents = body.contents.slice(-16).map(item => {
      const role = item?.role;
      const text = Array.isArray(item?.parts)
        ? item.parts.map(p => typeof p?.text === 'string' ? p.text : '').join('\n').slice(0, 5000)
        : '';
      if (!['user', 'model'].includes(role) || !text.trim()) {
        throw Object.assign(new Error('Riwayat chat tidak valid.'), { status: 400 });
      }
      return { role, parts: [{ text }] };
    });
  } catch (error) {
    return send(res, error.status || 400, { error: error.message || 'Riwayat chat tidak valid.' });
  }

  const context = typeof body.siteContext === 'string' ? body.siteContext.slice(0, 3000) : '';
  const prompt = typeof body.systemInstruction === 'string'
    ? body.systemInstruction.slice(0, 5000)
    : 'Anda adalah NutriBot, asisten edukasi gizi berbahasa Indonesia.';
  const systemText = prompt + (context ? '\n\nKonteks situs (gunakan hanya jika relevan):\n' + context : '');

  let lastStatus = 0;
  let lastMessage = '';

  for (const model of MODELS) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(API_KEY)}`;
    let retry = 0;
    while (retry < 2) {
      retry++;
      try {
        const upstream = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            system_instruction: { parts: [{ text: systemText }] },
            contents,
            generationConfig: { temperature: 0.7, maxOutputTokens: 900 }
          }),
          signal: AbortSignal.timeout(45000)
        });
        const data = await upstream.json().catch(() => ({}));
        if (upstream.ok) {
          const reply = data?.candidates?.[0]?.content?.parts
            ?.map(part => typeof part.text === 'string' ? part.text : '').join('\n').trim();
          if (reply) {
            console.log(`[chat] success model=${model}`);
            return send(res, 200, { reply, model });
          }
          lastStatus = 502;
          lastMessage = 'Gemini mengembalikan respons kosong atau respons diblokir oleh safety filter.';
          console.error(`[chat] empty response model=${model}`);
          break;
        }

        lastStatus = upstream.status;
        lastMessage = data?.error?.message || 'Google tidak memberikan detail error.';
        console.error(`[chat] Gemini error model=${model} status=${lastStatus}: ${lastMessage}`);

        // Model tidak tersedia/kuota model habis: coba model cadangan berikutnya.
        if ([404, 429, 500, 502, 503, 504].includes(lastStatus)) {
          if (lastStatus >= 500 && retry < 2) {
            await new Promise(resolve => setTimeout(resolve, 600));
            continue;
          }
          break;
        }
        // Key/permission/request errors biasanya tidak akan pulih dengan model lain.
        return send(res, 502, { error: friendlyGeminiError(lastStatus, lastMessage) });
      } catch (error) {
        lastStatus = 0;
        lastMessage = error?.name === 'TimeoutError'
          ? 'Permintaan ke Google melewati batas waktu 45 detik.'
          : (error?.cause?.message || error?.message || 'Koneksi keluar dari server gagal.');
        console.error(`[chat] network error model=${model}: ${lastMessage}`);
        if (retry < 2) {
          await new Promise(resolve => setTimeout(resolve, 500));
          continue;
        }
        break;
      }
    }
  }

  return send(res, 502, { error: friendlyGeminiError(lastStatus, lastMessage) });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (req.method === 'GET' && url.pathname === '/api/health') {
      return send(res, 200, { ok: true, apiKeyConfigured: Boolean(API_KEY), models: MODELS });
    }
    if (req.method === 'POST' && url.pathname === '/api/chat') {
      return await handleChat(req, res);
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return send(res, 405, { error: 'Metode HTTP tidak didukung.' });
    }

    const requested = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
    const safeName = path.normalize(requested).replace(/^([/\\])+/, '');
    const filePath = path.resolve(ROOT, safeName);
    if (!filePath.startsWith(ROOT + path.sep) && filePath !== ROOT) {
      return send(res, 403, { error: 'Akses file ditolak.' });
    }
    const content = await readFile(filePath);
    res.writeHead(200, {
      'Content-Type': mime[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff'
    });
    return res.end(req.method === 'HEAD' ? undefined : content);
  } catch (error) {
    if (!res.headersSent) {
      const status = error.code === 'ENOENT' ? 404 : (error.status || 500);
      return send(res, status, { error: status === 404 ? 'File tidak ditemukan.' : (error.message || 'Terjadi kesalahan pada server.') });
    }
    res.end();
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`NutriCompanion berjalan pada port ${PORT}`);
  console.log(`Gemini API key: ${API_KEY ? 'sudah dikonfigurasi' : 'BELUM ADA — atur GEMINI_API_KEY'}`);
  console.log(`Model cadangan: ${MODELS.join(', ')}`);
});
