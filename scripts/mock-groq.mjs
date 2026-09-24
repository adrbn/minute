// Faux Groq pour les tests (aucune clé nécessaire) : node scripts/mock-groq.mjs
// Transcription : renvoie une phrase indiquant la durée reçue. Chat : diffuse un compte-rendu factice.
import { createServer } from 'node:http';
let n = 0;
const phrases = [
  'Bonjour à tous, merci d’être là pour ce point sur la campagne DELF.',
  'On a reçu les chiffres de septembre, les inscriptions sont en hausse de douze pour cent.',
  'Il faudrait relancer les partenaires de Milan avant vendredi.',
  'Je m’occupe de la newsletter, Giulia prépare les visuels.',
  'Une question reste ouverte : le budget des réseaux sociaux pour octobre.',
];
createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = Buffer.concat(chunks);
  const auth = req.headers.authorization || '';
  if (!auth.includes('gsk_')) { res.writeHead(401); return res.end('{"error":{"message":"Invalid API Key"}}'); }
  res.setHeader('x-ratelimit-limit-requests', '2000');
  if (req.url.endsWith('/audio/transcriptions')) {
    // durée approximative d'après la taille du WAV 16 kHz mono 16 bits
    const i = body.indexOf('RIFF');
    const size = i >= 0 ? body.readUInt32LE(i + 40) : 0;
    const sec = (size / 32000).toFixed(1);
    const text = `${phrases[n++ % phrases.length]} (${sec} s)`;
    console.log('stt', sec, 's');
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ text, segments: [{ text, no_speech_prob: 0.01, avg_logprob: -0.2, compression_ratio: 1.3 }] }));
  }
  if (req.url.endsWith('/models')) {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ data: [{ id: 'openai/gpt-oss-120b' }, { id: 'llama-3.3-70b-versatile' }, { id: 'whisper-large-v3-turbo' }] }));
  }
  if (req.url.endsWith('/chat/completions')) {
    const j = JSON.parse(body.toString());
    const user = j.messages.at(-1).content;
    console.log('chat', user.length, 'chars');
    const out = user.includes('rattrapage')
      ? '**⚠️ On attend votre avis sur le budget réseaux sociaux.**\n- Inscriptions DELF en hausse de 12 %\n- Relance des partenaires de Milan avant vendredi'
      : user.includes('Question :')
        ? 'Les partenaires de Milan doivent être relancés avant vendredi [00:08].'
        : user.includes('e-mail de suivi')
          ? 'Objet : Suivi — campagne DELF\n\nBonjour à tous,\n\nMerci pour cet échange…\n\n[Prénom]'
          : '# Point campagne DELF de septembre\n\n## En bref\nPoint d’étape sur la campagne DELF : les inscriptions progressent et les relances partenaires sont lancées.\n\n## Décisions\n- Relancer les partenaires de Milan avant vendredi\n\n## Actions\n- [ ] **Moi** — Rédiger la newsletter\n- [ ] **Giulia** — Préparer les visuels (vendredi)\n\n## Points clés\n### Chiffres\n- Inscriptions en hausse de 12 % en septembre [00:04]\n\n## Questions ouvertes\n- Budget réseaux sociaux d’octobre';
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    for (const piece of out.match(/[\s\S]{1,12}/g)) {
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: piece } }] })}\n\n`);
      await new Promise((r) => setTimeout(r, 15));
    }
    res.write('data: [DONE]\n\n');
    return res.end();
  }
  res.writeHead(404);
  res.end();
}).listen(8765, () => console.log('mock groq on :8765'));
