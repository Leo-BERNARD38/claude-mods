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

Dans l'app desktop et VS Code, le bandeau dessine de vraies jauges (SVG) à la place des caractères : même contenu,
même repère du temps écoulé, lisibles en thème clair et sombre.
Quand un volet se rouvre, ses jauges sont redemandées (aussitôt, puis après 1,5 s), et de nouveau
toutes les 5 s : une image que la surface n'a pas su charger ne reste pas en texte de remplacement.
En attendant, ce texte de remplacement est la jauge en caractères (`━━━│───`), sur une ligne.

Sous 110 colonnes (panneau latéral, fenêtre étroite), le bandeau ne garde que les jauges : Session, Semaine,
Contexte (remplie à son niveau et découpée par composition) et Temps, étirées sur toute la largeur.
À droite de chacune : le % et le temps avant le reset (Session, Semaine), les tokens (Contexte),
la durée mesurée (Temps).

Dès l'ouverture de la session, avant la première réponse, le bandeau reprend le dernier relevé
(`~/.usage-pace/quotas.json`) : son % est précédé de `~` (et « relevé il y a … » en pleine largeur)
jusqu'à la première vraie mesure. Une fenêtre déjà repassée n'est pas reprise.
Le contexte a ses propres couleurs (bleu, rose, turquoise, orange), distinctes de celles du temps.

`/rythme` donne le même résumé en texte.

Purement informatif : ce mod ne bloque jamais rien. Pour que Claude gère lui-même ses quotas (ralentir,
s'arrêter, reprendre), c'est l'autre mod, [usage-pace-guard](../usage-pace-guard).

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
