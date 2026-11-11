# usage-pace-guard

Mod Claude Code : Claude gère lui-même ses quotas pour tenir jusqu'au reset de la semaine et la finir près
de 100 %, sans tout griller dès le lundi, et sans jamais te bloquer.

À installer là où tournent tes agents. Pour voir tes quotas en bas de l'écran, c'est l'autre mod,
[usage-pace](../usage-pace) (affichage seul, indépendant de celui-ci).

## Les règles

| Fenêtre | Rappel « ralentis » | Arrêt des agents |
| --- | --- | --- |
| **Semaine** | 5 points avant l'arrêt | quota permis = % de temps écoulé + 14 points (≈ 1 jour), plafonné à 100 |
| **Session 5 h** | 75 % | 80 % : les 20 % restants sont ta réserve |

Exemples pour la Semaine :

- lundi soir, 1 jour écoulé (14 %) : permis 28 %. Un agent à 30 % s'arrête et repart quand le temps a rattrapé ;
- dimanche à 5 h du reset (97 % écoulé) : permis 100 %. L'agent va jusqu'au bout ;
- 40 % utilisés à 2 jours du reset : permis 85 %, l'outil `quotas` dit « tu peux accélérer, ≈ 30 %/jour ».

## Agent ou toi ?

Une session où **tu** travailles n'est jamais bloquée : au plus un rappel.

| Mode | Quand |
| --- | --- |
| toi | la conversation principale, lancée par un message que tu as tapé (terminal, app, web, téléphone, SDK) |
| agent | un sous-agent (outil Agent), même dans ta session ; un tour lancé par une tâche planifiée, une autre session Claude, un coordinateur, la reprise auto |

Forcer le mode : variable d'environnement `USAGE_PACE_AGENT=1` (toujours agent, par exemple dans
l'environnement cloud de tes agents ou un script `claude -p`) ou `USAGE_PACE_AGENT=0` (jamais bloqué).
Une session cloud lancée depuis le web ou par l'API arrive comme « SDK », donc comme toi : pose
`USAGE_PACE_AGENT=1` dans l'environnement de tes agents.

## Ce qui se passe

| Quand | Ce qui se passe |
| --- | --- |
| à tout moment | Claude a un outil `quotas` : % Session / Semaine, permis maintenant, reset, conseil. |
| au rappel | après un résultat d'outil, Claude lit « ralentis » (tous les 15 appels). |
| à l'arrêt (agent) | les outils sont refusés, sauf `Write`/`Edit`/`Read` et les tâches, pour noter où il en est. |
| fin de l'échange | pause ; la barre d'état affiche l'heure de reprise. |
| quota de nouveau permis | la tâche est relancée par un prompt automatique (« relis ton fichier d'avancement »). |
| tu écris toi-même | la relance prévue est annulée : tu as repris la main. |

## Débloquer à la main : `/usage-pace:debloquer`

- `/usage-pace:debloquer` : lève l'arrêt tout de suite, relance la tâche en pause, et suspend le garde-fou jusqu'au
  reset de la fenêtre qui bloquait ;
- `/usage-pace:debloquer 2h` (ou `30min`, `1h30`, `1j`) : pour cette durée ;
- `/usage-pace:debloquer off` : réactive le garde-fou tout de suite.

La suspension est notée dans `~/.usage-pace/garde-fou.json` : tous les agents de la machine la voient,
sous-agents compris, et un agent en pause reprend dans les 30 s. L'outil `quotas` affiche
« Garde-fou suspendu jusqu'à … ». (Une session cloud a son propre disque : lance `/usage-pace:debloquer` dans celle-ci.)

## Réglages

Menu `/config`, ou `pluginConfigs.usage-pace-guard` dans `settings.json`. Les valeurs par défaut sont
celles qui s'appliquent partout où `/config` n'arrive pas (cloud, SSH, WSL).

| Réglage | Défaut | Rôle |
| --- | --- | --- |
| `semaine_marge` | 14 | avance permise sur le temps écoulé, en points (14 ≈ 1 jour) |
| `semaine_plafond` | 100 | le quota Semaine permis ne dépasse jamais ce % |
| `session_arret` | 80 | arrêt des agents sur la Session 5 h |
| `reprise_auto` | oui | relancer la tâche toute seule |

## Installer

```
/plugin install usage-pace-guard --marketplace Leo-BERNARD38/claude-mods
```

Ou à la main depuis ce dossier : `sh install.sh` (macOS / Linux) ou `install.ps1` (Windows).

**Mode projet / Cowork** : l'app y charge les skills des plugins, pas leurs hooks. Le skill `quotas`
s'en charge : il copie le mod dans les mods de la session et te demande « Turn them on » (une fois par session).

## Fichiers

| Fichier | Rôle |
| --- | --- |
| `hooks/guard.ts` | les calculs : seuils, rappel, refus, conseil, `/usage-pace:debloquer` |
| `hooks/register.ts` | le câblage : mesures, outil `quotas`, mode agent / toi, pause, reprise |
| `skills/quotas/SKILL.md` | charge le garde-fou là où les hooks ne tournent pas (mode projet, Cowork) |
| `types/index.d.ts` | l'état du mod |

## Vérifier

```
claude plugin validate .
claude plugin test .
npx tsc -p .
```
