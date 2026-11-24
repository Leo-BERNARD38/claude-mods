export const MIN = 60000;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;
const WINDOWS = {
    five_hour: { label: 'Session', length: 5 * HOUR },
    seven_day: { label: 'Semaine', length: 7 * DAY },
};
/** Le rappel arrive ce nombre de points avant l'arrêt. */
export const WARN_BEFORE = 5;
/** Le rappel revient tous les N appels d'outils. */
export const REMIND_EVERY = 15;
/** Laisser au serveur le temps de rouvrir la fenêtre avant de relancer. */
const RESUME_MARGIN = 2 * MIN;
/**
 * Ce qui reste permis à l'arrêt : de quoi noter où on en est, relire, et préparer la reprise
 * (rappels, réveils, tâches programmées), et charger le skill debloquer quand la personne le demande.
 */
const ALLOWED_WHEN_STOPPED = new Set([
    'Write',
    'Edit',
    'Read',
    'Grep',
    'Glob',
    'TodoWrite',
    'TaskCreate',
    'TaskUpdate',
    'TaskList',
    'TaskGet',
    'Skill',
    'ToolSearch',
    'ScheduleWakeup',
    'CronCreate',
    'CronList',
    'CronDelete',
    'ReadNotifications',
    'mcp__claude-code-remote__send_later',
    'mcp__claude-code-remote__list_triggers',
    'mcp__claude-code-remote__get_trigger',
    'mcp__claude-code-remote__delete_trigger',
]);
export function config(options) {
    const num = (v, d, min) => (typeof v === 'number' && v >= min && v <= 100 ? v : d);
    return {
        weekMargin: num(options.semaine_marge, 14, 0),
        weekCap: num(options.semaine_plafond, 100, 1),
        sessionStop: num(options.session_arret, 80, 1),
        resume: options.reprise_auto !== false,
    };
}
/** Chaque fenêtre avec son % réel, son seuil de rappel et d'arrêt maintenant. */
export function windows(limits, cfg, now) {
    return limits.flatMap(l => {
        const w = WINDOWS[l.kind];
        if (!w)
            return [];
        const reset = l.resetsAt ? Date.parse(l.resetsAt) : NaN;
        const resetAt = Number.isNaN(reset) ? undefined : reset;
        // une fenêtre dont le reset est passé est repartie de zéro
        const used = resetAt !== undefined && resetAt <= now ? 0 : l.percentUsed;
        const start = resetAt !== undefined ? resetAt - w.length : undefined;
        const elapsed = start !== undefined ? Math.min(100, Math.max(0, ((now - start) / w.length) * 100)) : undefined;
        let stopAt;
        let okAt = resetAt !== undefined ? resetAt + RESUME_MARGIN : undefined;
        if (l.kind === 'seven_day') {
            stopAt = Math.min(cfg.weekCap, (elapsed ?? 100) + cfg.weekMargin);
            // le permis monte avec le temps : on repasse sous le rappel quand temps + marge - 5 dépasse le %
            const need = used - cfg.weekMargin + WARN_BEFORE;
            if (start !== undefined && used < cfg.weekCap - WARN_BEFORE)
                okAt = start + (need / 100) * w.length;
        }
        else {
            stopAt = cfg.sessionStop;
        }
        return [
            { label: w.label, used, warnAt: Math.max(0, stopAt - WARN_BEFORE), stopAt, resetAt, elapsed, okAt },
        ];
    });
}
export function status(limits, cfg, now, mode, suspended) {
    const list = windows(limits, cfg, now);
    const worst = list.reduce((a, w) => (!a || w.used - w.stopAt > a.used - a.stopAt ? w : a), undefined);
    if (suspended && suspended > now)
        return { level: 'ok', worst, suspended };
    const stopped = list.filter(w => w.used >= w.stopAt);
    if (stopped.length && mode === 'agent') {
        const resumeAt = Math.max(...stopped.map(w => w.okAt ?? now));
        return { level: 'stop', worst, resumeAt };
    }
    const level = list.some(w => w.used >= w.warnAt) ? 'warn' : 'ok';
    return { level, worst };
}
const pct = (n) => `${Math.round(n)} %`;
/** 45s, 12min, 2h05, 3j4h */
export function duration(ms) {
    const minutes = Math.max(0, Math.round(ms / MIN));
    const d = Math.floor(minutes / 1440);
    const h = Math.floor((minutes % 1440) / 60);
    const m = minutes % 60;
    if (d)
        return `${d}j${h}h`;
    if (h)
        return `${h}h${String(m).padStart(2, '0')}`;
    return `${m}min`;
}
/** « dim. 18:00 », à l'heure de Paris. */
export function clock(ms) {
    return new Date(ms).toLocaleString('fr-FR', {
        weekday: 'short',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Europe/Paris',
    });
}
const when = (at, now) => `${clock(at)} (dans ${duration(at - now)})`;
/** Ce que Claude lit après un résultat d'outil, au-dessus du rappel. */
export function reminder(s, mode) {
    const w = s.worst;
    const head = `[usage-pace] Quota ${w.label} à ${pct(w.used)} (permis maintenant : ${pct(w.stopAt)}).`;
    if (mode === 'you')
        return (`${head} Tu travailles avec la personne : rien n'est bloqué. Évite les lots de sous-agents ` +
            `et les étapes lourdes sans le lui dire.`);
    return (`${head} Ralentis : pas de nouveau lot de sous-agents ni d'étape lourde, tiens ton fichier ` +
        `d'avancement à jour. À ${pct(w.stopAt)}, les outils s'arrêtent.`);
}
/** Le refus d'un outil à l'arrêt, ou null s'il reste permis. */
export function denial(tool, s, cfg, now, file) {
    if (s.level !== 'stop' || ALLOWED_WHEN_STOPPED.has(tool) || tool.startsWith('mcp__usage-pace-guard__'))
        return null;
    const w = s.worst;
    const resume = s.resumeAt
        ? cfg.resume
            ? ` Reprise automatique prévue ${when(s.resumeAt, now)}.`
            : ` Le quota le permet de nouveau ${when(s.resumeAt, now)}.`
        : '';
    const wake = s.resumeAt
        ? ` Avant de finir, programme ta reprise vers ${clock(s.resumeAt)} si un outil de rappel existe ` +
            `(send_later, ScheduleWakeup) : une session cloud peut dormir et manquer la relance.`
        : '';
    return (`[usage-pace] Pause : quota ${w.label} à ${pct(w.used)}, permis maintenant ${pct(w.stopAt)}. ` +
        `Les outils sont suspendus pour garder de la marge. Note l'avancement dans un fichier (Write/Edit ` +
        `restent permis), puis termine ta réponse par un court point d'étape.${resume}${wake} ` +
        `Seule la personne peut lever l'arrêt : /debloquer, ou /usage-pace-guard:debloquer, ou en te le ` +
        `demandant (skill debloquer${file ? `, fichier ${file}` : ''}). Ne le fais jamais de toi-même.`);
}
export const REFUSED_UNLOCK = `[usage-pace] Déblocage refusé : seule la personne peut lever l'arrêt, dans un message qu'elle a tapé ` +
    `elle-même (pas une tâche planifiée, une autre session ni un sous-agent). Dis-lui de lancer /debloquer ` +
    `ou de te le demander.`;
export const RESUME_PROMPT = `[usage-pace] Le quota le permet de nouveau. Reprends la tâche en cours là où tu t'étais arrêté : ` +
    `relis d'abord ton fichier d'avancement s'il existe, puis continue.`;
/** La réponse de l'outil quotas : de quoi décider seul d'accélérer ou de ralentir. */
export function report(limits, cfg, now, mode, extra = {}) {
    const list = windows(limits, cfg, now);
    if (!list.length)
        return ('Pas encore de mesure des limites : le mod les reçoit avec les réponses du modèle, il lui en faut une ' +
            'complète après son chargement (souvent 2 tours dans une session neuve, en mode projet ou Cowork). ' +
            'Finis ce tour, puis rappelle quotas au suivant. Toujours rien après 2 tours : pas d’abonnement Pro/Max, ' +
            'ou cette surface ne transmet pas les limites.');
    const lines = list.map(w => {
        const reset = w.resetAt && w.resetAt > now ? `, reset ${when(w.resetAt, now)}` : '';
        const room = w.stopAt - w.used;
        const advice = room > 2 * WARN_BEFORE
            ? 'de la marge, tu peux accélérer'
            : room > WARN_BEFORE
                ? 'dans le rythme'
                : 'ralentis';
        const perDay = w.label === 'Semaine' && w.resetAt && w.resetAt - now > DAY
            ? ` ; pour finir la semaine à ${pct(cfg.weekCap)} : ≈ ${pct((cfg.weekCap - w.used) / ((w.resetAt - now) / DAY))}/jour`
            : '';
        return `- ${w.label} : ${pct(w.used)} utilisé, permis maintenant ${pct(w.stopAt)}${reset} → ${advice}${perDay}`;
    });
    const s = status(limits, cfg, now, mode, extra.suspended);
    const who = mode === 'you'
        ? 'Mode : session de la personne, jamais bloquée (rappel seulement).'
        : 'Mode : agent, arrêt au permis.';
    const rules = `Règles : Session, arrêt des agents à ${pct(cfg.sessionStop)} ; Semaine, permis = temps écoulé + ` +
        `${cfg.weekMargin} points (plafond ${pct(cfg.weekCap)}) ; rappel ${WARN_BEFORE} points avant.`;
    return [
        ...lines,
        `${who} ${rules}`,
        ...(s.suspended
            ? [`Garde-fou suspendu jusqu'à ${clock(s.suspended)} (/debloquer off pour le réactiver).`]
            : []),
        ...(extra.paused ? [`En pause, relance prévue ${clock(extra.paused)}.`] : []),
    ].join('\n');
}
/** « 2h », « 30min », « 1h30 », « 45m », « 1j », « 2d » → ms ; null si illisible. */
export function parseDuration(text) {
    const m = text
        .trim()
        .toLowerCase()
        .match(/^(?:(\d+)\s*[jd])?\s*(?:(\d+)\s*h)?\s*(?:(\d+)\s*(?:min|mn|m)?)?$/);
    if (!m || !text.trim())
        return null;
    const [, d = '0', h = '0', mn = '0'] = m;
    const ms = +d * DAY + +h * HOUR + +mn * MIN;
    return ms > 0 ? ms : null;
}
/**
 * /debloquer : jusqu'à quand suspendre le garde-fou.
 * Sans argument : jusqu'au reset de la fenêtre qui bloque (ou qui rappelle, sinon la Session).
 */
export function unlockUntil(args, limits, cfg, now) {
    const arg = args.trim().toLowerCase();
    if (arg === 'off')
        return { off: true };
    if (arg) {
        const ms = parseDuration(arg);
        return ms
            ? { until: now + ms, why: `pour ${duration(ms)}` }
            : { error: `Durée illisible : « ${args.trim()} ». Exemples : 2h, 30min, 1h30, 1j, off.` };
    }
    const list = windows(limits, cfg, now).filter(w => w.resetAt && w.resetAt > now);
    const pick = [list.filter(w => w.used >= w.stopAt), list.filter(w => w.used >= w.warnAt)].find(g => g.length) ??
        list.filter(w => w.label === 'Session');
    const until = Math.max(...pick.map(w => w.resetAt));
    if (!pick.length || !Number.isFinite(until))
        return { until: now + 5 * HOUR, why: 'pour 5h (pas de reset connu)' };
    return { until, why: `jusqu'au reset ${pick.map(w => w.label).join(' + ')}` };
}
