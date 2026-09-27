# Analyse fonctionnelle — Poker Home Games (app.pokerhomegames.app)

> Relevé réalisé le 27/09/2026 à partir de l'application en ligne (compte connecté, forfait Free) et de l'inventaire des libellés présents dans l'application web.
> Objectif : servir de référence pour concevoir notre propre outil d'organisation de parties de poker.
> Le document principal pour la réalisation est [00-PLAN-ET-SPECS-TECHNIQUES.md](00-PLAN-ET-SPECS-TECHNIQUES.md).

---

## 1. Vue d'ensemble

Poker Home Games (PHG) est une application web mono-page destinée aux **organisateurs de tournois de poker** (entre amis, clubs associatifs). Elle combine :

1. **Un timer de tournoi** (blindes, niveaux, pauses, statistiques en direct) affichable sur un écran / une TV.
2. **Un panneau de pilotage** (« Réglages ») pour gérer le tournoi : paramètres, joueurs, tables, structure, places payées.
3. **Des modules d'organisation** : planning avec pages de pré-inscription, championnats (classements sur la saison), historique, tournois multi-jours (flights), sessions Multi Sit-and-Go, gestion de club/adhérents.
4. **Des vues publiques** : plan des tables, classement de championnat, page d'inscription, page club.

Stack observée : SPA React (Vite), backend Supabase (Postgres + Auth + Storage + RPC), paiement Stripe, formulaire support Formspree.

Cadres d'utilisation (choisis à l'onboarding) : **Privé** (argent possible) ou **Club associatif** (pas d'aspect monétaire : lots ou gratuit, rake désactivé ; accès aux modules club).

---

## 2. Authentification & compte

| Fonction | Détail |
|---|---|
| Connexion | Email + mot de passe, ou « Continuer avec Google » |
| Inscription | Email + mot de passe, acceptation des CGU obligatoire, email de confirmation |
| Mot de passe oublié | Envoi d'un email de réinitialisation |
| Onboarding | « Finalisez votre compte » : type de compte (Privé / Club associatif), CGU |
| Mon compte | Prénom, nom, pseudo, nom du club (unique), photo de profil (upload/suppression), cadre d'utilisation, activer le rake, changer d'email (confirmation), changer de mot de passe (min 6 caractères), déconnexion |
| Abonnement | Forfait courant, gestion via Stripe |
| Avis | Note 1–5 étoiles + avis, consentement de publication, modération |
| Support | Formulaire email + message |

---

## 3. L'écran principal : le timer

### 3.1 Affichage (desktop / TV)
- **Titre du tournoi** (renommable, par défaut « Tournoi entre amis »).
- **Colonne statistiques** : Joueurs (actifs / total entrées), Moyenne (tapis moyen), Prizepool (€), Recaves, Add-ons, Heure locale (option).
- **Bloc central** : « TEMPS RESTANT » en grand (mm:ss), badge PAUSE, barre de progression du niveau (scrubbable), « NIVEAU n — SB / BB », Ante, « NIVEAU SUIVANT : SB / BB ».
- **Colonne droite** : « PAUSE DANS xx min », « FIN ENR. TARDIF DANS xhxx », liste des **places payées** (1er Prix, 2e Prix…), bouton **Sortant**.
- En pause (niveau de type pause) : affichage « PAUSE ».
- Fin de structure : « FIN ».
- Alerte « ÉQUILIBRAGE NÉCESSAIRE » quand des déplacements sont requis (bouton « C'EST FAIT »).
- Titre de l'écran : `<titre du tournoi> - Poker Home Games`.

### 3.2 Contrôles
- Lecture / Pause (« ▶ Reprendre » / « ⏸ Pause »), Niveau précédent, Niveau suivant (avec confirmation « Passer au niveau n ? », « Passer à la pause ? »).
- Slider de progression pour avancer/reculer dans le niveau.
- Raccourcis clavier (flèches, Home, Espace).
- Démarrage impossible avec moins de 2 joueurs (« Ajoutez au moins 2 joueurs pour démarrer »).
- **Mode TV / Projecteur**, **Plein écran**.
- **Mobile** : vue compacte (boutons Sortant, Scan QR Code, Ajouter joueur, mini-contrôles timer) — le téléphone sert de télécommande.
- **Synchronisation multi-écrans** : l'état du timer est stocké côté serveur (niveau courant, en pause, temps restant à la pause, horodatage de début de niveau) ; tous les écrans se resynchronisent ; conflit détecté (« Le niveau a déjà changé sur un autre écran »). Horloge serveur synchronisée.
- **Journal du timer** (admin) : origine (tap humain, fin de niveau auto, conflit refusé), appareil.

### 3.3 Actions joueur depuis le timer
- **Sortant** : « Qui est éliminé ? » → recherche joueur → si re-entry autorisé : « Faire un re-entry ? OUI (Re-entry) / NON (Sortant) » → si comptage des kills : « Éliminé par ? » → nouveau siège attribué.
- **Recave** : « Qui recave ? », **Add-on** : « Qui prend un add-on ? », **Annuler une recave**.
- **Déplacer un joueur** : vers une table/siège libre ou **inverser** avec un joueur.
- **Scan QR** : pointage de présence / inscription d'un joueur préinscrit (caméra, photo ou saisie du code).
- **Ajouter joueur** (y compris après late reg avec « dérogation » explicite).

### 3.4 Sons
- Alertes : Lancement du tournoi (« Shuffle up and deal »), Alerte 1 min restante, Fin de niveau (compte à rebours final).
- Activation globale, volume (propres à l'appareil), test, sons personnalisés (MP3/WAV/M4A, 2 Mo max) liés au tournoi.

### 3.5 Personnalisation du timer (thème)
- Couleur principale (fond des blocs), couleur secondaire (liserés, badges, barre de progression), couleur du titre.
- Effet verre : opacité, flou.
- Police du timer : Inter, Oswald, Oxanium, Montserrat, Roboto, Lato.
- Image de fond et logo personnalisés (PNG/SVG, 2 Mo max, glisser-déposer), retour au défaut.
- Afficher l'heure locale.
- Aperçu en direct ; « Réinitialiser le thème ».

---

## 4. Réglages — onglet « Général » (paramètres du tournoi)

### 4.1 Format d'entrée
| Format | Effet |
|---|---|
| **Freezeout** | Élimination définitive |
| **Re-entry** | Nouveau siège attribué ; nombre max de re-entry (illimité ou N) ; interdit après la fin de la late registration |
| **Recaves** (rebuy) | Le joueur garde son siège ; + option **Add-on** (coût, stack add-on) |

Contraintes : recaves incompatibles avec le bounty (bascule auto en Freezeout) ; format verrouillé une fois le tournoi commencé.

### 4.2 Jetons & économie
- Stack de départ (préréglages 5k/10k/20k/30k ou libre).
- Buy-in (€) ou **Gratuit** (aucune place payée, aucun gain affiché).
- **Rake** (si activé dans le compte).
- **Masquer le payout** sur le timer.
- Aperçu : Prize pool, Inscrits, Jetons en jeu, Tables.

### 4.3 Championnat
- « Comptabiliser le nombre d'éliminations par joueur » (demande le tueur à chaque sortie ; classement des éliminations sur la saison).

### 4.4 Tables
- Joueurs par table : 2 (Head's up) à 10 (Full ring).
- Joueurs en table finale.
- Aperçu : « À n joueurs restants, les tables seront à a vs b », « À n joueurs restants, fusion en table finale ».
- **Équilibrage automatique** (déplace les joueurs pour garder des tables égales).
- **Casse des tables par ordre décroissant** (la table au numéro le plus haut est cassée en premier).

### 4.5 Bounty
| Type | Règle |
|---|---|
| Aucun | Tout le buy-in va au prize pool |
| Fixe | Prime fixe par élimination (part du buy-in) |
| Progressif | 50 % gagnés, 50 % ajoutés à la prime de l'éliminateur |
| Mystery | Prime aléatoire : grille d'**enveloppes** (groupes Top/High/Mid/Low/Min), figement de la grille (auto en fin de late reg), tirage à partir de N joueurs restants, mode Digital (tirage à l'écran) / Impression (enveloppes physiques), animation TV |

En cadre associatif, les bounties sont exprimés **en points**. La prime ne peut pas dépasser le buy-in.

### 4.6 Configurations favorites
- Enregistrer la configuration courante (format, stack, buy-in, tables, bounty…), la renommer, la charger (uniquement avant démarrage), la supprimer.

### 4.7 Cycle de vie du tournoi (« Tournoi de cet écran »)
- Statuts : Préparé (aucun joueur) → En cours / En pause → Terminé.
- **Réinitialiser le tournoi** : joueurs, structure et chrono à zéro, logo conservé (action irréversible).
- **Terminer** : archive le live dans l'historique et libère l'écran (un tournoi vierge le remplace).
- **Exporter le tournoi actuel (CSV)**.
- **Tournois simultanés** (Club+) : plusieurs lives en parallèle, éventuellement avec **horloge liée** (même timer & structure, joueurs séparés).

---

## 5. Gestion des joueurs

- Ajout : pseudo (obligatoire, unique dans le tournoi), prénom, nom (facultatifs) ; depuis « Mon club ».
- **Import d'une liste** CSV/TXT (une ligne par joueur, modèle téléchargeable, doublons ignorés).
- Modifier / supprimer un joueur (« Il sera retiré définitivement »).
- Éliminer, annuler l'élimination, re-entry, recave, add-on, annuler recave/add-on.
- **Pointage de présence** (appel) pour les joueurs importés du planning ; types Invité / Adhérent / Compte.
- **Tirage des sièges** (🎲) et **retirage** (redraw) en cours de tournoi (confirmation).
- **Tables** : ajouter/supprimer une table, ouvrir une table vide, verrouiller une table, verrouiller comme table finale, verrouiller un joueur sur son siège.
- **Équilibrage** : calcul des déplacements nécessaires, bannière sur le timer, « Les tables sont parfaitement équilibrées ! ».
- **Plan des tables public** : lien (nouvel onglet) valable jusqu'à la fin/réinitialisation du live ; vue tables / vue liste, pagination auto-défilante, plein écran, impression.
- Fin de tournoi : « Tournoi terminé ! » → **Classement final** (place, joueur, gain/lots, vainqueur), export CSV, **envoi vers un championnat**.

---

## 6. Éditeur de structure

- Liste des niveaux : SB, BB, Ante, Durée (min), type Niveau / Pause, marqueur **LateReg** (fin des inscriptions tardives à la fin de ce niveau).
- Ajouter un niveau, ajouter une pause, supprimer, réorganiser par glisser-déposer.
- **Générateur** : joueurs (total), stack de départ, durée (heures), durée des niveaux (min), plus petit jeton, ante (BB ante) oui/non, pauses tous les N niveaux → résumé (départ, fin estimée, durée de jeu estimée, profondeur moyenne finale, nb de niveaux) → valider dans l'éditeur.
- **Import CSV** (colonnes type, SB, BB, Ante, Durée ; validations détaillées ; aperçu ; uniquement avant démarrage).
- **Structures favorites** : sauvegarder, renommer, charger, supprimer (quota par forfait).
- Structure par défaut : 20 min/niveau, 50/100 → 6000/12000, BB ante à partir du niveau 5, pauses de 10 min, late reg à la 2e pause.

---

## 7. Gestion des places payées

- Nature de la récompense : **Monétaire** (montants) ou **Lots** (objets, texte libre).
- **Répartition automatique** en fonction du nombre d'entrées et du prize pool.
- Mode manuel : ajouter/supprimer une place payée, montant par rang, contrôle « Répartition ok » (somme = prize pool).
- Non disponible en mode Gratuit ; message si buy-in à 0.

---

## 8. Mon planning (pages de pré-inscription)

- Événements : nom, type (Tournoi classique / Session Multi Sit-and-Go), date, heure, lieu, capacité max, format (joueurs/table), stack de départ, mode financier (buy-in en argent / dotation en lots / gratuit), buy-in.
- **Options personnalisées** posées aux joueurs (Oui / Non / Ne sais pas, ex. « Présent au repas, prévoir 15 € »), figées après publication.
- Statuts : Brouillon → Inscriptions ouvertes → Inscriptions closes → Importée (archivée).
- Page publique d'inscription (lien copiable).
- Suivi des préinscrits : À valider, Validés, Présents, Liste d'attente, Refusés ; actions Valider, Dévalider, Refuser, Présent ; export des préinscrits.
- **Import dans le live** : les présents, ou tous les validés (sans vérifier les présences) ; la page est alors fermée et archivée.
- Actifs / Archivés, quota d'événements par forfait.

---

## 9. Championnats

- Créer un championnat (nom ≤ 30 car., type **MTT** ou **SnG**), renommer, archiver / réactiver, réinitialiser les scores, supprimer.
- Recevoir les tournois terminés (« Envoyer vers un championnat ») — un tournoi peut aller dans plusieurs championnats, une seule fois chacun.
- **Formule de points** : `points = 10 × √(nombre d'entrées / rang)` arrondi au dixième (+ grille dédiée pour les SnG).
- **Jokers** : ne retenir que les N meilleurs résultats.
- Classement : position, évolution de place, joueur, points (dont bonus), kills, tournois joués / retenus ; détail des scores par joueur.
- **Bonus** : points positifs avec justification (historisés, annulables).
- **Fusion de joueurs** (combine points, kills, tournois, bonus).
- Historique des imports (annulables : les points sont retirés).
- **Publication** d'un classement public (lien partageable, podium, classement général, détail par joueur) ; dépublier.
- Lien entre un joueur classé et un adhérent du club.

---

## 10. Historique

- Liste des tournois archivés (recherche), récapitulatif : classement, joueurs, entrées, gains, bounties, vainqueur, stats.
- Export CSV, export vers un championnat, suppression de la fiche.

---

## 11. Modules avancés (forfaits Club / Club+)

### 11.1 Multi Sit-and-Go
Session regroupant plusieurs SnG sur un timer partagé (freezeout, gratuit imposés) ; joueurs par SnG, élimination/réintégration, export vers un championnat SnG, CSV.

### 11.2 Tournois flights (multi-jours)
Dossier (≤ 12 jours) : Day 1A/1B → Day 2 → finale ; % de qualifiés par jour, tapis de départ, clôture d'un jour avec saisie des tapis (« bagués »), page d'inscription par jour, récap global, export championnat.

### 11.3 Mon club (gestion d'adhérents)
Fiche club & page publique (logo, ville, description), saisons (une seule ouverte), demandes d'adhésion, adhérents (avec ou sans compte joueur), types d'adhésion (Live / Online / Online + Live), cotisations et dons (suivi indicatif, méthodes Espèces/Chèque/Virement/HelloAsso), rôles personnalisés, cartes de membre QR imprimables, inscription d'adhérents à un tournoi, renouvellements.

---

## 12. Forfaits (monétisation PHG)

| Forfait | Principales limites |
|---|---|
| Free | 6 joueurs max, pas de bounty, thème par défaut |
| One Time (pass soirée) | 20 joueurs, 1 page de pré-inscription |
| Sit-and-Go | 10 joueurs, structures favorites, 1 championnat, 2 pages |
| Club | Joueurs illimités, 6 pages, Multi SnG |
| Club+ (14,99 €/mois) | + Mon club, 3 tournois simultanés, flights |

> Notre version est un outil personnel : **pas de forfaits ni de paiement**, toutes les fonctions sont débloquées.

---

## 13. Administration PHG (hors périmètre)
Console Super Admin (attribution manuelle de forfaits), modération des avis, statistiques (organisateurs, lives, pic de concurrence), journal timer.
