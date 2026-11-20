/*
 * Симулятор баланса: прогоняет много партий, где за всех игроков играют боты.
 * Запуск:  node simulate.js [кол-во партий] [сложность]
 * Пример:  node simulate.js 300 hard
 */
const E = require('./engine.js');
const N = +process.argv[2] || 200, DIFF = process.argv[3] || 'normal';
const profs = E.D.PROFS.map(p => p.id);
const st = { games: 0, over: 0, stuck: 0, errors: 0, wins: {}, humanBankrupt: 0, botBankrupt: 0, exitTurns: {}, midTurns: {}, debts: 0, gameTurns: [] };
for (let g = 0; g < N; g++) {
  const prof = profs[g % profs.length];
  let s = E.newGame({ prof, diff: DIFF, seed: g * 7919 + 1, allBots: true, name: 'Игрок' });
  let steps = 0;
  while (s.phase !== 'over' && steps < 20000) {
    const a = E.botAction(s);
    if (!a) { st.stuck++; break; }
    const r = E.act(s, a);
    if (!r.ok) { st.errors++; if (st.errors < 5) console.log('ERR', a, r.events[0].text, s.card && s.card.kind); break; }
    s = r.state; steps++;
  }
  st.games++;
  for (const p of s.players) {
    if (p.bankrupt) p.bot && p.id ? st.botBankrupt++ : st.humanBankrupt++;
    const key = p.id === 0 ? 'Игрок/' + prof : p.name;
    if (p.mode !== 'rat') (st.midTurns[key] = st.midTurns[key] || []).push(p.midAt);
    if (p.mode === 'fast') (st.exitTurns[key] = st.exitTurns[key] || []).push(p.fastAt);
    st.debts += p.loans.filter(l => l.shady).length ? 1 : 0;
  }
  if (s.phase === 'over') {
    st.over++;
    const res = s.result, w = res.type === 'win' ? (res.pid === 0 ? 'Игрок/' + prof : s.players[res.pid].name) + ' (' + res.how + ')' : 'банкрот игрока';
    st.wins[w] = (st.wins[w] || 0) + 1;
    st.gameTurns.push(Math.max(...s.players.map(p => p.turns)));
  }
}
const avg = a => a.length ? (a.reduce((x, y) => x + y, 0) / a.length).toFixed(1) : '—';
console.log(`Сложность: ${DIFF}, партий: ${st.games}, завершено: ${st.over}, зависло: ${st.stuck}, ошибок: ${st.errors}`);
console.log(`Средняя длина партии: ${avg(st.gameTurns)} ходов на игрока`);
console.log(`Банкротства: игрок ${st.humanBankrupt}, боты ${st.botBankrupt}`);
console.log('Исходы:'); Object.entries(st.wins).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${k}: ${v}`));
console.log(`Игроков с долгом коллекторам к концу партии: ${st.debts}`);
console.log('Выход из колеса → средний круг (средний ход, сколько раз):');
Object.entries(st.midTurns).forEach(([k, v]) => console.log(`  ${k}: ход ${avg(v)}, ${v.length} раз`));
console.log('Выход в Большую игру (средний ход, сколько раз):');
Object.entries(st.exitTurns).forEach(([k, v]) => console.log(`  ${k}: ход ${avg(v)}, ${v.length} раз`));
