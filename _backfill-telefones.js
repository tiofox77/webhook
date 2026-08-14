// Preenche o telefone real nos registos JÁ existentes do CRM.
// A sessão do WhatsApp guarda o mapeamento nos dois sentidos; os 40 clientes
// WhatsApp do CRM resolvem-se todos. Sem isto, o histórico continuava a mostrar
// "245264443002975@lid" e o dono não conseguia ligar a quem ficou a meio.
const fs = require('fs');
const path = require('path');
const SESSAO = 'C:/Users/fox/.hermes/whatsapp/session';

function mapaLidParaTelefone() {
  const map = {};
  let ficheiros = [];
  try { ficheiros = fs.readdirSync(SESSAO); } catch { return map; }
  for (const f of ficheiros) {
    try {
      // lid-mapping-<LID>_reverse.json  → conteúdo = número
      let m = f.match(/^lid-mapping-(\d+)_reverse\.json$/);
      if (m) { const tel = String(JSON.parse(fs.readFileSync(path.join(SESSAO, f), 'utf8')) || '').replace(/\D/g, ''); if (tel) map[m[1]] = tel; continue; }
      // lid-mapping-<numero>.json → conteúdo = LID
      m = f.match(/^lid-mapping-(\d+)\.json$/);
      if (m) { const lid = String(JSON.parse(fs.readFileSync(path.join(SESSAO, f), 'utf8')) || '').replace(/\D/g, ''); if (lid) map[lid] = m[1]; }
    } catch {}
  }
  return map;
}

const map = mapaLidParaTelefone();
console.log('mapeamentos LID→telefone disponíveis: ' + Object.keys(map).length);

const alvos = [
  { f: 'C:/superloja/data/crm/conversations.json', id: 'senderId' },
  { f: 'C:/superloja/data/crm/leads.json', id: 'senderId' },
  { f: 'C:/superloja/data/crm/orders.json', id: 'senderId' },
];

for (const alvo of alvos) {
  let db;
  try { db = JSON.parse(fs.readFileSync(alvo.f, 'utf8')); } catch { console.log('  (sem ' + path.basename(alvo.f) + ')'); continue; }
  if (!Array.isArray(db)) { console.log('  (' + path.basename(alvo.f) + ' não é lista)'); continue; }
  fs.writeFileSync(alvo.f.replace('.json', '.backup-tel-' + Date.now() + '.json'), JSON.stringify(db, null, 2), 'utf8');

  let mudou = 0, jaTinha = 0, semMapa = 0;
  const clientes = new Set();
  for (const r of db) {
    const bruto = String(r[alvo.id] || '');
    if (!bruto) continue;
    if (r.telefone) { jaTinha++; continue; }
    const lid = bruto.replace(/[@:].*/, '');
    let tel = map[lid] || '';
    // conversa normal (não-LID): o número já está no próprio JID
    if (!tel && /@s\.whatsapp\.net$/.test(bruto) && /^\d{8,}$/.test(lid)) tel = lid;
    if (!tel) { semMapa++; continue; }
    r.telefone = tel;
    clientes.add(tel);
    mudou++;
  }
  fs.writeFileSync(alvo.f, JSON.stringify(db, null, 2), 'utf8');
  console.log(path.basename(alvo.f) + ': ' + mudou + ' registos preenchidos (' +
    clientes.size + ' clientes distintos), ' + jaTinha + ' já tinham, ' + semMapa + ' sem mapeamento');
}
