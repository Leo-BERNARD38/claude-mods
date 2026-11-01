# claude-mods

Mods Claude Code de Léo.

| Mod | Ce qu'il fait |
| --- | --- |
| [usage-pace](./usage-pace) | Bandeau des limites Session / Semaine, contexte et session, et `/rythme`. Purement informatif, ne bloque rien |
| [usage-pace-guard](./usage-pace-guard) | Garde-fou pour les agents : Claude règle son rythme pour finir la semaine près de 100 %, s'arrête au quota permis et reprend tout seul ; `/debloquer`. Ne bloque jamais ta session |

Les deux sont indépendants : installe le bandeau là où tu travailles, le garde-fou là où tournent tes agents.

## Installer

À l'invite d'une session Claude Code (terminal) :

```
/plugin install usage-pace --marketplace Leo-BERNARD38/claude-mods
/plugin install usage-pace-guard --marketplace Leo-BERNARD38/claude-mods
```

Depuis un shell :

```
claude plugin install usage-pace --marketplace Leo-BERNARD38/claude-mods
claude plugin install usage-pace-guard --marketplace Leo-BERNARD38/claude-mods
```

Dans l'app desktop, où `/plugin` ne marche pas : clique sur + à côté de la zone de saisie, puis Plugins,
Add marketplace avec `Leo-BERNARD38/claude-mods`, puis Add plugin.
