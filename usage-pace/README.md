# usage-pace

Mod Claude Code : un bandeau au-dessus du prompt pour savoir si tu peux rusher ou s'il faut ralentir.

```
Session   ━│──│──────  12%   ✓ tu peux accélérer        temps écoulé 46% · reste 88% pour 2h43 · vider ≈ 25% de semaine
Semaine   ━━━━━━│───  66%   = dans le rythme           temps écoulé 66% · reste 34% pour 2j9h ≈ 14%/jour
Contexte  ━━━━──────  40%                              80k / 200k tokens
  dont    █████▓▓░░▒  51%   surtout : conversation     conversation 41k · MCP 18k (dont github 13k) · …
Ici       1h12 · 23 échanges · 41 outils · 2 fichiers modifiés · cache 92% · a pris +7% session, +2% semaine
Temps     ███▓▓▓▓▓▓░  60%   goulot : les outils        Claude 6min · outils 12min · toi 2min · plus lent : npm test 9min (×3)
```

Dans l'app desktop, le bandeau dessine de vraies jauges (SVG) à la place des caractères : même contenu,
même repère du temps écoulé, lisibles en thème clair et sombre.

`/rythme` donne le même résumé en texte (utile dans l'extension VS Code, où le bandeau ne s'affiche pas).

## Garde-fou : Claude gère lui-même ses quotas

Pour lancer une longue tâche sans te priver du chat :

| Quand | Ce qui se passe |
| --- | --- |
| à tout moment | Claude a un outil `quotas` : % Session / Semaine, heure du reset, rythme. Il l'appelle avant une étape lourde. |
| ≥ **seuil** (80 %) | après un résultat d'outil, Claude lit un rappel : finir l'étape, noter l'avancement dans un fichier, s'arrêter. Rappel répété tous les 15 appels. |
| ≥ **seuil d'arrêt** (90 %) | les outils sont refusés, sauf `Write`/`Edit`/`Read` et les tâches, pour noter où il en est. Sous-agents compris. |
| fin de l'échange | si le garde-fou est intervenu : pause, la barre d'état affiche l'heure de reprise. |
| reset passé (+2 min) | la tâche est relancée par un prompt automatique (« relis ton fichier d'avancement, puis continue »). |
| tu écris toi-même | la relance prévue est annulée : tu as repris la main. |

Réglages (menu `/config`, ou `pluginConfigs.usage-pace` dans `settings.json`) : `seuil`, `seuil_arret`, `reprise_auto`.
La relance tient tant que la session reste ouverte (un rechargement du mod la réarme).

Les limites sont aussi écrites dans `~/.usage-pace/quotas.json` (avec `updatedAt`) à chaque mesure,
pour les Claude qui ne chargent pas le mod, par exemple une session de l'app reliée à ce PC.

## Installer

Depuis la marketplace (recommandé), à l'invite d'une session Claude Code :

```
/plugin install usage-pace --marketplace Leo-BERNARD38/claude-mods
```

Depuis un shell : `claude plugin install usage-pace --marketplace Leo-BERNARD38/claude-mods`.
Dans l'app desktop : + à côté de la zone de saisie, Plugins, Add marketplace avec `Leo-BERNARD38/claude-mods`, puis Add plugin.

Ou à la main, depuis un dossier local :

1. Décompresse le dossier `usage-pace` là où il restera (par exemple `C:\Users\<toi>\claude-mods\usage-pace`).
   Le mod est lu depuis ce dossier : ne le déplace pas ensuite, ou relance l'installation.
2. Lance le script d'installation depuis ce dossier :
   - **Windows** : clic droit sur `install.ps1` > *Exécuter avec PowerShell*
     (ou `powershell -ExecutionPolicy Bypass -File install.ps1`)
   - **macOS / Linux** : `sh install.sh` (demande Node.js, déjà là si Claude Code est installé via npm)
3. Ouvre une nouvelle session Claude Code (terminal ou onglet Code de l'app) : le bandeau apparaît après la première réponse.

Le script ajoute le dossier du mod à `CLAUDE_CODE_PLUGIN_DIRS` dans `~/.claude/settings.json`, sans toucher au reste
(une copie de l'ancien fichier est gardée dans `settings.json.bak`).
Pour l'essayer sans rien installer : `claude --plugin-dir <chemin du dossier>`.

Prérequis : Claude Code 2.1.287 ou plus récent, et un abonnement Pro ou Max pour les limites Session / Semaine.

## Comment c'est calculé

- **Verdict des limites** : quota restant ÷ temps restant. 1 = dans le rythme ; ≥ 1,25 tu peux accélérer ;
  < 0,9 ralentis ; < 0,8 ça va couper (notification une fois par fenêtre). Le `│` de la barre marque le temps écoulé.
- **Vider ≈ X % de semaine** : ce que la session en cours a pris sur les deux limites donne le coût d'1 % de session
  en semaine (dès 3 % de session consommés).
- **Compaction dans ≈ N échanges** : annoncée (en jaune) seulement à 5 échanges ou moins, d’après la croissance moyenne du contexte.
- **Temps** : durée des appels d'outils (parallèles comptés une fois) ; le reste de l'échange est à Claude ;
  les appels qui ont demandé ton accord vont dans « toi » (validation + exécution, indissociables).

## Fichiers

| Fichier | Rôle |
| --- | --- |
| `hooks/register.tsx` | câblage : quels évènements alimentent quelles données |
| `hooks/limits.ts` | rythme, verdicts et alertes des limites |
| `hooks/guard.ts` | garde-fou : seuils, rappel, refus, reprise, réponse de l'outil `quotas` |
| `hooks/context.ts` | remplissage, composition et compaction du contexte |
| `hooks/session.ts` | compteurs de la session en cours |
| `hooks/timing.ts` | répartition du temps et outil le plus lent |
| `hooks/view.ts` | assemblage des lignes et version texte |
| `hooks/band.tsx` | dessin du bandeau (terminal, et version app desktop) |
| `hooks/svg.ts` | jauges SVG de l'app desktop |
| `hooks/format.ts` | durées, nombres, jauges |
| `types/index.d.ts` | types et contrat de l'état |

## Vérifier

```
claude plugin validate .
claude plugin test .
npx tsc -p .
```
