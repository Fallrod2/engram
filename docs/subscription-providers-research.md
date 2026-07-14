# Recherche — Utiliser un abonnement IA (Codex/Claude/…) comme provider dans engram

> **Étude du 14/07/2026 (sources consultées le jour même). Statut : aide à la décision — rien d'implémenté.**

## Résumé exécutif

| Provider                         | Statut juillet 2026                                                                                                                                                                                    | Faisabilité pour engram                                         | Risque ToS                                                                |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------- | ------------------------------------------------------------------------- |
| **OpenAI (ChatGPT/Codex OAuth)** | **Toléré et publiquement endossé** pour les outils tiers (Cline, OpenClaw l'embarquent) — mais **pas de programme développeur formel** (pas d'enregistrement de client OAuth, feature request ouverte) | Bonne (device-code flow, headless-friendly)                     | Faible en mono-user self-hosted, **zone grise en multi-tenant hébergé**   |
| **Anthropic (Claude Pro/Max)**   | **Interdit** d'offrir un login Claude.ai dans un produit tiers ; carve-out : usage **personnel** via Claude Code / Agent SDK (`claude setup-token`)                                                    | Usage personnel d'Alex uniquement, jamais comme feature produit | Élevé hors usage personnel ; politique instable (3 revirements en 6 mois) |
| **Google (AI Pro/Ultra)**        | **Mort** : ban février 2026, bans de comptes dès mars, login abonnement retiré de Gemini CLI le 18/06/2026                                                                                             | Nulle                                                           | Maximal (bans de comptes payants documentés)                              |
| **GitHub Copilot**               | Aucune API officielle ; uniquement des proxies reverse-engineered                                                                                                                                      | À proscrire                                                     | Élevé (violation confirmée, risque sur le compte GitHub)                  |
| **Mistral (Le Chat Pro)**        | Abonnement et API totalement étanches, aucun pont                                                                                                                                                      | Nulle                                                           | —                                                                         |

**La seule voie sérieuse en juillet 2026 est OpenAI**, et elle reste un pattern « harness » toléré plutôt qu'une plateforme officielle.

## 1. OpenAI — détails

- « Sign in with ChatGPT » (exploré mai 2025) n'a **pas** débouché sur un SSO générique : aucun enregistrement self-service de client OAuth tiers (feature request ouverte : openai/codex#10974). Les outils tiers réutilisent le client OAuth public du Codex CLI.
- OpenAI **endosse publiquement** l'usage du Codex OAuth dans des outils tiers : docs OpenClaw (« OpenAI explicitly supports subscription OAuth usage in external tools »), déclaration Thibault Sottiaux (via MindStudio), Cline « Sign in with OpenAI » shippé le 22/01/2026.
- Cas web le plus proche d'engram : le composant `<LoginWithChatGPT />` de Savio Martin (26/06/2026, React + device auth) — **sans réaction publique d'OpenAI à ce jour**, l'auteur lui-même doute de la conformité ToS.
- Technique : OAuth 2.0 + PKCE sur `auth.openai.com` (flux navigateur, callback localhost:1455) ou **device-code (bêta, headless-friendly)** — doc user-facing : developers.openai.com/codex/auth. Token utilisable contre le backend Codex (`chatgpt.com/backend-api`, format Responses) qui **valide une forme de requête « Codex »** (les instructions système doivent être adaptées). Pas d'accès aux endpoints Platform classiques.
- Modèles (07/2026) : gpt-5.6-sol/terra/luna, gpt-5.5, variantes codex. Quotas partagés avec l'usage Codex de l'abonné (Plus ≈ 15-90 messages/5 h + cap hebdo ; fenêtre 5 h suspendue le 12/07 au profit d'un cap hebdo seul).
- Consensus ToS (ai-sub-auth, opencode-openai-codex-auth) : **OK pour un outil personnel exécuté par l'utilisateur ; « For production or multi-user applications, use the OpenAI Platform API »**. Une web app multi-tenant hébergée stockant les tokens Codex de ses utilisateurs = zone grise non tranchée.

## 2. Anthropic — chronologie 2026

- 09-12/01 : blocage des tokens OAuth Max dans les clients tiers, reversé en quelques jours.
- 18-19/02 : ToS — OAuth Free/Pro/Max réservé à Claude Code et Claude.ai (usage personnel inchangé).
- 04/04 : enforcement — les abonnements ne couvrent plus les harnesses tiers ; « extra usage credits » prépayés.
- 13-14/05 : annonce d'un « Agent SDK credit » mensuel couvrant aussi les apps tierces authentifiées via l'Agent SDK, effectif 15/06.
- 15-16/06 : **annulation le jour J** — tout recompte dans les limites d'abonnement ; préavis promis avant tout futur changement.
- **État au 14/07/2026** (code.claude.com/docs/en/legal-and-compliance) : « Anthropic does not permit third-party developers to offer Claude.ai login or to route requests through Free, Pro, or Max plan credentials on behalf of their users. » Carve-out : usage individuel (Claude Code ; Agent SDK via `claude setup-token` → `CLAUDE_CODE_OAUTH_TOKEN`, token 1 an inference-only).

## 3. Recommandation pour engram

1. **Court terme : ne rien casser** — API keys + OpenRouter/Ollama restent la seule voie « production-safe ».
2. **Si feature « abonnement » : uniquement OpenAI**, en adapter `openai-codex` **expérimental** : device-code flow (pas de redirect à enregistrer, marche sur Hono self-hosted comme sur Vercel), stockage access+refresh tokens dans le modèle credentials write-only existant (prévoir le refresh, absent des adapters key-based), requêtes au format Responses avec la contrainte d'instructions Codex, `supportsVision:false` tant que non vérifié. **Gate explicite : réservé au self-hosted mono-utilisateur, flag « expérimental », jamais activé sur une instance multi-tenant hébergée tant qu'OpenAI n'a pas publié de programme officiel.** Surveiller openai/codex#10974 et une éventuelle GA de « Sign in with ChatGPT ».
3. **Anthropic : pas de « Sign in with Claude »** (interdit). Seule option défendable : adapter optionnel `CLAUDE_CODE_OAUTH_TOKEN` fourni par l'utilisateur self-hosted (personal use only) — politique instable, priorité basse.
4. **Google, Copilot, Mistral : exclus.**

## Sources principales (14/07/2026)

developers.openai.com/codex/auth · github.com/openai/codex/issues/10974 · cline.bot/blog/introducing-openai-codex-oauth (22/01/2026) · explainx.ai (LoginWithChatGPT, 27/06/2026) · docs.openclaw.ai/providers/openai · code.claude.com/docs/en/legal-and-compliance · code.claude.com/docs/en/authentication · support.claude.com art. 15036540 (maj 15/06/2026) · zed.dev/blog/anthropic-subscription-changes (16/06/2026) · venturebeat.com (04/2026) · theregister.com (20/02/2026) · github.com/google-gemini/gemini-cli discussion #22970 · github.com/ericc-ch/copilot-api · github.com/AlexAnys/ai-sub-auth (v0.2.0) · cloudzero.com (Mistral pricing) · simplemetrics.xyz (Codex limits).
