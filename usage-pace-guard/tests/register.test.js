// De bout en bout : le mod chargé par le moteur, ses hooks branchés sur de faux évènements.
import { expect, mock, test } from 'claude-code/testing';
import { DAY, HOUR, MIN } from '../hooks/guard';
const NOW = Date.parse('2026-11-01T13:00:00Z');
const at = (ms) => new Date(NOW + ms).toISOString();
const HIGH = [
    { kind: 'five_hour', percentUsed: 85, resetsAt: at(1 * HOUR) },
    { kind: 'seven_day', percentUsed: 40, resetsAt: at(3 * DAY) },
];
const SUSPENSION = '/home/toi/.usage-pace/garde-fou.json';
/** Ce que Claude Code répondrait, avec un disque en mémoire. */
function engine(on, env = {}, register = true) {
    const clock = mock.clock(on, { now: NOW });
    mock.store(on);
    const files = {};
    const submitted = [];
    on('env.get', (_$, e) => ({ value: e.name === 'HOME' ? '/home/toi' : env[e.name] }));
    on('fs.read', (_$, e) => {
        if (!(e.path in files))
            throw new Error('ENOENT');
        return { value: files[e.path] };
    });
    on('fs.write', (_$, e) => ((files[e.path] = e.text), { value: undefined }));
    if (register) {
        on('command.register', () => ({ value: undefined }));
        on('tool.register', () => ({ value: { tool: 'mcp__usage-pace-guard__quotas' } }));
    }
    on('session.start', () => ({ cwd: '/projet' }));
    on('session.measure', (_$, e) => ({ changed: e.changed }));
    on('session.usage', () => ({ value: { startedAt: NOW, rateLimits: HIGH, context: {} } }));
    on('tool.call', () => ({ result: {} }));
    on('turn.complete', (_$, e) => ({ text: e.answer }));
    on('prompt.submit', (_$, e) => (submitted.push(e.text), { text: e.text }));
    return { clock, files, submitted };
}
const turn = (id) => ({ answer: 'pause', durationMs: 1000, isAborted: false, turnId: id, reason: 'answer' });
const prompt = (kind) => ({ text: 'go', wait: false, origin: { kind } });
const debloquer = (args) => ({
    command: 'debloquer',
    args,
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 120 },
});
test('ta session, Session à 85 % : rien n’est refusé, un rappel ; ton sous-agent, lui, s’arrête', async ($, on) => {
    const state = engine(on);
    await $.session.start({ cwd: '/projet', surface: 'terminal', isInteractive: true });
    await $.prompt.submit(prompt('composer'));
    const bash = await $.tool.call({ tool: 'Bash', command: 'npm test' });
    expect(bash.deny).toBeUndefined();
    expect(String(bash.context?.[0])).toContain("rien n'est bloqué");
    const sub = await $.tool.call({ tool: 'Bash', command: 'npm test', agentId: 'a1' });
    expect(String(sub.deny)).toContain('Pause : quota Session à 85 %');
    // et ta session ne se met pas en pause pour autant : aucune relance automatique
    const { submitted } = state;
    await $.turn.complete(turn('t1'));
    await state.clock.advance(2 * HOUR);
    expect(submitted.length).toBe(1);
});
test('agent lancé par une tâche planifiée : arrêt, pause, relance après le reset', async ($, on) => {
    const { clock, submitted } = engine(on);
    await $.session.start({ cwd: '/projet', surface: null, isInteractive: false });
    await $.prompt.submit(prompt('scheduled-trigger'));
    const bash = await $.tool.call({ tool: 'Bash', command: 'npm test' });
    expect(String(bash.deny)).toContain('Pause : quota Session à 85 %');
    const quotas = await $.tool.call({ tool: 'mcp__usage-pace-guard__quotas' });
    expect(String(quotas.result)).toContain('Mode : agent');
    await $.turn.complete(turn('t1'));
    expect(submitted.length).toBe(1);
    await clock.advance(1 * HOUR + 3 * MIN);
    expect(submitted.length).toBe(2);
    expect(submitted[1]).toContain('Reprends la tâche en cours');
});
test('USAGE_PACE_AGENT=1 : agent même quand le message vient du SDK', async ($, on) => {
    engine(on, { USAGE_PACE_AGENT: '1' });
    await $.session.start({ cwd: '/projet', surface: null, isInteractive: false });
    await $.prompt.submit(prompt('sdk'));
    expect((await $.tool.call({ tool: 'Bash', command: 'ls' })).deny).toBeDefined();
});
test('/debloquer : lève l’arrêt tout de suite, relance la tâche en pause ; off le réactive', async ($, on) => {
    const { clock, files, submitted } = engine(on, { USAGE_PACE_AGENT: '1' });
    await $.session.start({ cwd: '/projet', surface: null, isInteractive: false });
    await $.tool.call({ tool: 'Bash', command: 'ls' });
    await $.turn.complete(turn('t1'));
    const r = await $.command.run(debloquer(''));
    expect(r.text).toContain('Garde-fou suspendu jusqu');
    expect(r.text).toContain('reset Session');
    expect(JSON.parse(files[SUSPENSION]).until).toBe(NOW + HOUR);
    await clock.advance(1100);
    expect(submitted.at(-1)).toContain('Reprends la tâche en cours');
    expect((await $.tool.call({ tool: 'Bash', command: 'ls' })).deny).toBeUndefined();
    const quotas = await $.tool.call({ tool: 'mcp__usage-pace-guard__quotas' });
    expect(String(quotas.result)).toContain('Garde-fou suspendu jusqu');
    expect((await $.command.run(debloquer('off'))).text).toBe('Garde-fou réactivé.');
    expect((await $.tool.call({ tool: 'Bash', command: 'ls' })).deny).toBeDefined();
});
test('/debloquer lancé dans une autre session : l’agent en pause reprend sans attendre le reset', async ($, on) => {
    const { clock, files, submitted } = engine(on, { USAGE_PACE_AGENT: '1' });
    await $.session.start({ cwd: '/projet', surface: null, isInteractive: false });
    await $.tool.call({ tool: 'Bash', command: 'ls' });
    await $.turn.complete(turn('t1'));
    const before = submitted.length;
    files[SUSPENSION] = JSON.stringify({ until: NOW + 2 * HOUR });
    await clock.advance(31000);
    expect(submitted.length).toBe(before + 1);
    expect((await $.tool.call({ tool: 'Bash', command: 'ls' })).deny).toBeUndefined();
});
test('le démarrage va au bout : /debloquer et les outils quotas et debloquer sont enregistrés', async ($, on) => {
    const names = [];
    engine(on, {}, false);
    on('command.register', (_$, e) => (names.push(`/${e.name}`), { value: { command: e.name } }));
    on('tool.register', (_$, e) => (names.push(e.name), { value: { tool: e.name } }));
    await $.session.start({ cwd: '/projet', surface: 'terminal', isInteractive: true });
    expect(names.sort()).toEqual(['/debloquer', 'debloquer', 'quotas']);
});
test('un enregistrement refusé n’emporte pas le reste du démarrage', async ($, on) => {
    const { clock, files, submitted } = engine(on, { USAGE_PACE_AGENT: '1' }, false);
    on('command.register', () => {
        throw new Error('non');
    });
    on('tool.register', (_$, e) => ({ value: { tool: e.name } }));
    await $.session.start({ cwd: '/projet', surface: null, isInteractive: false });
    await $.tool.call({ tool: 'Bash', command: 'ls' });
    await $.turn.complete(turn('t1'));
    const before = submitted.length;
    // la surveillance du déblocage tourne quand même
    files[SUSPENSION] = JSON.stringify({ until: NOW + 2 * HOUR });
    await clock.advance(31000);
    expect(submitted.length).toBe(before + 1);
});
test('à l’arrêt, les outils de reprise restent permis : rappel, skill, recherche', async ($, on) => {
    engine(on, { USAGE_PACE_AGENT: '1' });
    await $.session.start({ cwd: '/projet', surface: null, isInteractive: false });
    for (const tool of ['mcp__claude-code-remote__send_later', 'ScheduleWakeup', 'Skill', 'Grep', 'ToolSearch'])
        expect((await $.tool.call({ tool })).deny).toBeUndefined();
    const bash = await $.tool.call({ tool: 'Bash', command: 'ls' });
    expect(String(bash.deny)).toContain('/debloquer');
    expect(String(bash.deny)).toContain(SUSPENSION);
});
test('cloud (USAGE_PACE_AGENT=1) : la personne demande, l’agent débloque avec l’outil', async ($, on) => {
    const { files } = engine(on, { USAGE_PACE_AGENT: '1' });
    await $.session.start({ cwd: '/projet', surface: null, isInteractive: false });
    await $.prompt.submit(prompt('sdk'));
    await $.tool.call({ tool: 'Bash', command: 'ls' });
    await $.turn.complete(turn('t1'));
    await $.prompt.submit(prompt('sdk'));
    const r = await $.tool.call({ tool: 'mcp__usage-pace-guard__debloquer', duree: '2h' });
    expect(String(r.result)).toContain('Garde-fou suspendu jusqu');
    expect(JSON.parse(files[SUSPENSION]).until).toBe(NOW + 2 * HOUR);
    // la personne est là : pas de relance automatique, l'agent continue dans ce tour
    expect((await $.tool.call({ tool: 'Bash', command: 'ls' })).deny).toBeUndefined();
});
test('skill debloquer sans outil : la demande écrite dans le fichier est convertie en heure', async ($, on) => {
    const { clock, files } = engine(on, { USAGE_PACE_AGENT: '1' });
    await $.session.start({ cwd: '/projet', surface: null, isInteractive: false });
    await $.prompt.submit(prompt('bridge'));
    const w = await $.tool.call({ tool: 'Write', file_path: SUSPENSION, content: '{"demande":"reset"}' });
    expect(w.deny).toBeUndefined();
    files[SUSPENSION] = '{"demande":"reset"}';
    await clock.advance(6000);
    await $.tool.call({ tool: 'Read', file_path: '/projet/x' });
    expect(JSON.parse(files[SUSPENSION]).until).toBe(NOW + HOUR);
    expect((await $.tool.call({ tool: 'Bash', command: 'ls' })).deny).toBeUndefined();
});
test('un agent autonome (tâche planifiée, sous-agent) ne peut pas se débloquer lui-même', async ($, on) => {
    engine(on);
    await $.session.start({ cwd: '/projet', surface: null, isInteractive: false });
    await $.prompt.submit(prompt('scheduled-trigger'));
    const tool = await $.tool.call({ tool: 'mcp__usage-pace-guard__debloquer' });
    expect(String(tool.deny)).toContain('Déblocage refusé');
    const write = await $.tool.call({ tool: 'Write', file_path: SUSPENSION, content: '{}' });
    expect(String(write.deny)).toContain('Déblocage refusé');
    await $.prompt.submit(prompt('composer'));
    const sub = await $.tool.call({ tool: 'mcp__usage-pace-guard__debloquer', agentId: 'a1' });
    expect(String(sub.deny)).toContain('Déblocage refusé');
});
