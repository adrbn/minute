// Petit pilote Chrome DevTools Protocol pour tester l'app lancée avec --remote-debugging-port.
// node scripts/cdp.mjs list | shot <pageSubstr> <out.png> | eval <pageSubstr> "<js>"
const port = process.env.CDP_PORT || 9333;
const [cmd, match, arg] = process.argv.slice(2);
const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
if (cmd === 'list') {
  for (const t of targets) console.log(t.type, t.url, t.title);
  process.exit(0);
}
const t = targets.find((x) => x.type === 'page' && x.url.includes(match));
if (!t) { console.error('page introuvable', match); process.exit(1); }
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let id = 0;
const pending = new Map();
ws.addEventListener('message', (m) => {
  const d = JSON.parse(m.data);
  if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); }
});
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
if (cmd === 'shot') {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  const fs = await import('node:fs');
  fs.writeFileSync(arg, Buffer.from(r.result.data, 'base64'));
  console.log('ok', arg);
} else if (cmd === 'click') {
  // vrai clic souris (événements pointer/mouse natifs) au centre de l'élément ciblé
  const q = await send('Runtime.evaluate', { expression: `(() => { const r = document.querySelector(${JSON.stringify(arg)}).getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`, returnByValue: true });
  const [x, y] = q.result.result.value;
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  console.log('clicked', arg, Math.round(x), Math.round(y));
} else if (cmd === 'eval') {
  const r = await send('Runtime.evaluate', { expression: arg, awaitPromise: true, returnByValue: true, userGesture: true });
  console.log(JSON.stringify(r.result?.result?.value ?? r.result, null, 1));
}
ws.close();
