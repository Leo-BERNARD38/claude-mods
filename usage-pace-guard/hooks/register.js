// Le câblage du garde-fou : mesures, outils quotas et debloquer, rappels, refus, pause, reprise, /debloquer.
// Les calculs sont dans guard.ts.
import { atom, read, update } from 'claude-code';
import { REMIND_EVERY, REFUSED_UNLOCK, RESUME_PROMPT, clock, config, denial, reminder, report, status, unlockUntil, } from './guard';
const limits = atom({ plugin: 'usage-pace-guard', key: 'limits' }, []);
const mode = atom({ plugin: 'usage-pace-guard', key: 'mode' }, 'you');
const guard = atom({ plugin: 'usage-pace-guard', key: 'guard' }, { calls: 0, stopped: false });
/** Le message qui lance un tour vient d'un automatisme : la session est menée par un agent. */
const AGENT_ORIGINS = new Set([
    'scheduled-trigger',
    'peer',
    'peer-send-message',
    'projects-relay',
    'coordinator',
    'observer',
    'observer-activity',
    'plugin',
]);
/** Ni toi ni un agent : on garde le mode en cours. */
const NEUTRAL_ORIGINS = new Set(['task-notification', 'unclassified']);
/** Ceux qui tapent eux-mêmes : seuls eux peuvent lever l'arrêt (commande, skill, outil debloquer). */
const HUMAN_ORIGINS = new Set(['composer', 'bridge', 'sdk']);
/** Pendant une pause, on regarde à ce rythme si un déblocage a été posé ailleurs. */
const POLL_MS = 30000;
/** La suspension est relue au plus à ce rythme (elle est lue à chaque appel d'outil). */
const SUSPENSION_TTL_MS = 5000;
/** USAGE_PACE_AGENT=1 : toujours agent ; =0 : jamais bloqué. Lu au démarrage. */
let forced;
let resumeTimer;
let cache;
/** Le tour en cours a été lancé par un message de la personne (même si USAGE_PACE_AGENT=1). */
let humanTurn = false;
const suspensionFile = async ($) => {
    const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME'));
    return home ? `${home}/.usage-pace/garde-fou.json` : undefined;
};
/** Pose la suspension (ou la lève, avec off) dans le fichier, relance la tâche en pause. */
async function applyUnlock($, cfg, args) {
    const now = await $.clock.now();
    const r = unlockUntil(args, await read($, limits), cfg, now);
    if ('error' in r)
        return r.error;
    const path = await suspensionFile($);
    if (!path)
        return 'Pas de dossier personnel (HOME) où noter la suspension.';
    if ('off' in r) {
        await $.fs.write(path, JSON.stringify({ setAt: now }, null, 2));
        cache = { at: now };
        return 'Garde-fou réactivé.';
    }
    await $.fs.write(path, JSON.stringify({ until: r.until, setAt: now }, null, 2));
    cache = { until: r.until, at: now };
    const wasPaused = (await read($, guard)).paused;
    if (wasPaused) {
        await clearPause($);
        // pas depuis la commande ou l'outil (ils tiennent le tour) : juste après
        $.clock.after(1000, () => void $.prompt.submit({ text: RESUME_PROMPT }));
    }
    return (`Garde-fou suspendu jusqu'à ${clock(r.until)} (${r.why}), pour tous les agents de cette machine. ` +
        `${wasPaused ? 'La tâche en pause reprend. ' : ''}/debloquer off pour le réactiver.`);
}
/**
 * La suspension, posée depuis n'importe quelle session : un fichier, pour que tous les agents le voient.
 * Le skill debloquer y écrit { "demande": "2h" | "reset" | "off" } (sans horloge) : on la convertit ici.
 */
async function suspension($, cfg, fresh = false) {
    const now = await $.clock.now();
    if (!fresh && cache && now - cache.at < SUSPENSION_TTL_MS)
        return cache.until;
    let until;
    try {
        const path = await suspensionFile($);
        const body = path ? JSON.parse(await $.fs.read(path)) : {};
        if (typeof body.demande === 'string' && body.until === undefined) {
            await applyUnlock($, cfg, body.demande === 'reset' ? '' : body.demande);
            return cache?.until;
        }
        if (typeof body.until === 'number' && body.until > now)
            until = body.until;
    }
    catch {
        // pas de fichier : pas de suspension
    }
    cache = { until, at: now };
    return until;
}
async function modeOf($, agentId) {
    if (forced)
        return forced;
    // un sous-agent est un agent, même dans ta session
    return agentId ? 'agent' : read($, mode);
}
function clearPause($) {
    resumeTimer?.cancel();
    resumeTimer = undefined;
    $.ui.status(undefined);
    return update($, guard, g => ({ ...g, paused: undefined }));
}
function armResume($, cfg, at, now) {
    resumeTimer?.cancel();
    $.ui.status(`⏸ quotas : reprise auto vers ${clock(at)}`);
    resumeTimer = $.clock.after(Math.max(1000, at - now), () => void resume($, cfg));
}
/** À l'échéance (ou après un déblocage) : relance si le quota le permet, sinon réarme. */
async function resume($, cfg) {
    const fresh = (await $.session.usage()).rateLimits;
    if (fresh.length)
        await update($, limits, () => fresh.map(l => ({ ...l })));
    const now = await $.clock.now();
    const s = status(await read($, limits), cfg, now, 'agent', await suspension($, cfg, true));
    if (s.level === 'stop' && s.resumeAt && s.resumeAt > now) {
        await update($, guard, g => ({ ...g, paused: s.resumeAt }));
        return armResume($, cfg, s.resumeAt, now);
    }
    await clearPause($);
    await update($, guard, g => ({ ...g, calls: 0 }));
    await $.prompt.submit({ text: RESUME_PROMPT });
}
/**
 * /debloquer. Pas de « : » : le moteur refuse ce nom, et tout le démarrage du mod sautait avec.
 * La version préfixée, /usage-pace-guard:debloquer, est le skill (elle marche aussi dans le cloud).
 */
const CMD = 'debloquer';
const TOOL_PREFIX = 'mcp__usage-pace-guard__';
/** Un enregistrement refusé ne doit pas emporter les autres (ni le reste du démarrage). */
const quietly = async ($, what, op) => {
    try {
        await op;
    }
    catch (err) {
        $.ui.log(`usage-pace-guard : ${what} non enregistré (${String(err)})`);
    }
};
export const register = (on, options) => {
    const cfg = config(options);
    on('session.start', async ($, e, next) => {
        const result = await next(e);
        const env = await $.env.get('USAGE_PACE_AGENT');
        forced = env === '1' ? 'agent' : env === '0' ? 'you' : undefined;
        await quietly($, `/${CMD}`, $.command.register({
            name: CMD,
            description: `Lève l’arrêt des agents (quotas) : jusqu’au reset, ou /${CMD} 2h, ou /${CMD} off`,
            argumentHint: '[2h | off]',
        }));
        await quietly($, 'outil quotas', $.tool.register({
            name: 'quotas',
            description: 'Lit tes limites d’abonnement Claude (Session 5 h, Semaine 7 j) : % utilisé, quota permis maintenant, ' +
                'reset, conseil (accélérer, ralentir). Appelle-le avant une étape longue ou un lot de sous-agents, ' +
                'et régulièrement pendant une tâche longue.',
            inputSchema: { type: 'object', properties: {} },
            isDeferred: false,
        }));
        await quietly($, 'outil debloquer', $.tool.register({
            name: 'debloquer',
            description: 'Lève l’arrêt des agents dû aux quotas (ou le réactive). À appeler UNIQUEMENT quand la personne le ' +
                'demande elle-même dans son message ; jamais de ta propre initiative. duree : vide (jusqu’au reset), ' +
                '« 2h », « 30min », « 1j », ou « off ».',
            inputSchema: { type: 'object', properties: { duree: { type: 'string' } } },
            isDeferred: false,
        }));
        const usage = await $.session.usage();
        if (usage.rateLimits.length)
            await update($, limits, () => usage.rateLimits.map(l => ({ ...l })));
        const paused = (await read($, guard)).paused;
        if (paused && cfg.resume)
            armResume($, cfg, paused, await $.clock.now());
        // une pause levée par un déblocage posé dans une autre session (ou par le skill)
        $.clock.every(POLL_MS, async () => {
            if ((await read($, guard)).paused && (await suspension($, cfg, true)))
                await resume($, cfg);
        });
        return result;
    });
    on('session.measure', async ($, e, next) => {
        if (e.rateLimits.length)
            await update($, limits, () => e.rateLimits.map(l => ({ ...l })));
        return next(e);
    });
    // qui mène la conversation : toi (message tapé) ou un agent (tâche planifiée, autre session…)
    on('prompt.submit', async ($, e, next) => {
        const kind = e.origin.kind;
        if (!NEUTRAL_ORIGINS.has(kind) && !e.turnId)
            humanTurn = HUMAN_ORIGINS.has(kind);
        if (!NEUTRAL_ORIGINS.has(kind)) {
            const human = !AGENT_ORIGINS.has(kind);
            // un message d'agent glissé dans ton tour ne te transforme pas en agent
            if (human || !e.turnId)
                await update($, mode, () => (human ? 'you' : 'agent'));
            // tu reprends la main : la relance automatique n'a plus lieu d'être (sauf /debloquer, qui relance)
            if (human && e.command?.name !== CMD && (await read($, guard)).paused)
                await clearPause($);
        }
        return next(e);
    });
    on('tool.call', async ($, e, next) => {
        const now = await $.clock.now();
        const who = await modeOf($, e.agentId);
        const list = await read($, limits);
        const suspended = await suspension($, cfg);
        const path = await suspensionFile($);
        const asked = humanTurn && !e.agentId;
        if (e.tool === `${TOOL_PREFIX}debloquer`) {
            if (!asked)
                return { deny: REFUSED_UNLOCK };
            const duree = e.duree;
            return { result: await applyUnlock($, cfg, typeof duree === 'string' ? duree : '') };
        }
        if (e.tool.startsWith(TOOL_PREFIX)) {
            return { result: report(list, cfg, now, who, { paused: (await read($, guard)).paused, suspended }) };
        }
        // le fichier de suspension : seule une demande de la personne peut l'écrire (skill debloquer)
        const target = e.file_path;
        if ((e.tool === 'Write' || e.tool === 'Edit') && path && target === path && !asked) {
            return { deny: REFUSED_UNLOCK };
        }
        const s = status(list, cfg, now, who, suspended);
        const deny = denial(e.tool, s, cfg, now, path);
        if (deny) {
            await update($, guard, g => ({ ...g, stopped: true }));
            return { deny };
        }
        const result = await next(e);
        if (s.level === 'ok' || result.deny !== undefined || result.isError)
            return result;
        const g = await read($, guard);
        const due = g.calls === 0 || g.calls >= REMIND_EVERY;
        await update($, guard, x => ({ ...x, calls: due ? 1 : x.calls + 1 }));
        return due ? { ...result, context: [...(result.context ?? []), reminder(s, who)] } : result;
    });
    // fin d'un échange où des outils ont été refusés : pause, relance quand le quota le permet
    on('turn.complete', async ($, e, next) => {
        if (!e.agentId) {
            const g = await read($, guard);
            await update($, guard, x => ({ ...x, stopped: false }));
            const now = await $.clock.now();
            const s = status(await read($, limits), cfg, now, 'agent', await suspension($, cfg, true));
            // ta session ne se met jamais en pause, même si un de tes sous-agents s'est arrêté
            const agent = (await modeOf($)) === 'agent';
            if (agent && g.stopped && cfg.resume && s.level === 'stop' && s.resumeAt) {
                await update($, guard, x => ({ ...x, paused: s.resumeAt }));
                armResume($, cfg, s.resumeAt, now);
                $.ui.toast(`⏸ Pause quotas : ${s.worst?.label} à ${Math.round(s.worst?.used ?? 0)} %. Reprise ${clock(s.resumeAt)}.`);
            }
        }
        return next(e);
    });
    on('command.run', { command: CMD }, async ($, e) => ({ text: await applyUnlock($, cfg, e.args) }));
};
