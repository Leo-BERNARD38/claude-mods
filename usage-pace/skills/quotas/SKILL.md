---
name: quotas
description: Lire les limites d'abonnement Claude de la personne (Session 5 h, Semaine 7 j) et se mettre en pause avant de les atteindre. À utiliser quand la personne parle de ses quotas, limites, usage ou « où on en est », et avant de lancer une tâche longue, un lot de sous-agents ou un travail qui tourne en fond. Charge le garde-fou usage-pace dans les sessions où ses hooks ne tournent pas (mode projet, Cowork).
---

# Quotas : lire ses limites et faire une pause avant la coupure

Le garde-fou usage-pace donne à Claude un outil `mcp__usage-pace__quotas` (% Session et Semaine, heure du reset,
rythme), lui rappelle de s'arrêter au seuil (80 %), suspend les outils au seuil d'arrêt (90 %) et relance la
tâche après le reset. Ses hooks tournent tout seuls dans Claude Code ; dans le mode projet et Cowork, il faut
le charger comme mod de la session, une fois par session.

## 1. L'outil est-il déjà là ?

Cherche `mcp__usage-pace__quotas` (dans la liste des outils, ou avec ToolSearch, requête « quotas »).
S'il est là, appelle-le, réponds avec ses chiffres et va à l'étape 3. Ne copie rien : le mod tourne déjà.

## 2. Sinon : charger le mod dans cette session

1. Charge le skill `plugin-authoring` avec l'outil Skill. Son texte nomme le dossier des mods de la session
   (`WHERE TO WRITE IT`, de la forme `/root/.claude/dev-mods/<id>/`). Appelle-le `MODS`.
   Si ce skill n'existe pas dans la session, dis-le en une phrase et va au point 6.
2. Le dossier du plugin est deux niveaux au-dessus du dossier de ce skill (`<base>/../..`) : il contient
   `.claude-plugin/plugin.json` et `hooks/register.tsx`. Vérifie-le avec `ls`.
3. Copie-le, sans le dossier `skills` ni ce qui est caché à part `.claude-plugin` :
   ```bash
   SRC="$(cd "<base>/../.." && pwd)"; DST="MODS/usage-pace"
   mkdir -p "$DST" && cp -r "$SRC/.claude-plugin" "$SRC/hooks" "$SRC/types" "$DST/" && rm -rf "$DST/.claude-plugin/types"
   ```
   Si `hooks/register.tsx` manque dans `SRC`, prends le dépôt public à la place :
   `git clone --depth 1 https://github.com/Leo-BERNARD38/claude-mods /tmp/claude-mods`, puis
   `SRC=/tmp/claude-mods/usage-pace` et la même copie.
4. Dis à la personne, en une phrase : « Réponds “Turn them on” à la question qui s'affiche : c'est ce qui
   charge le garde-fou quotas dans cette session. » La question n'apparaît qu'une fois par session.
5. Le mod se charge à la fin de ton tour : un avis te le dit, et l'outil `mcp__usage-pace__quotas` arrive.
   Appelle-le alors et donne les chiffres. Si la personne refuse, ne repose pas la question.
6. Sans le mod, tu ne peux pas lire les quotas : dis-le simplement, et propose de lire la page
   Paramètres > Utilisation de claude.ai dans le navigateur.

## 3. Pendant une tâche longue

- Appelle `quotas` avant chaque étape lourde ou lot de sous-agents, et environ toutes les 20 actions.
- Tiens un fichier d'avancement (ce qui est fait, ce qui reste, la prochaine action) dès que la tâche dure.
- À partir du seuil (rappel `[usage-pace]` dans les résultats d'outils) : finis l'étape en cours, mets le
  fichier d'avancement à jour, puis arrête-toi avec un court point d'étape. Le garde-fou relance la tâche
  après le reset ; à la relance, relis le fichier d'avancement avant de continuer.
- Ne contourne jamais un refus `[usage-pace]` : il garde de la marge pour que la personne puisse utiliser
  Claude ailleurs.
