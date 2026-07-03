# Déployer Ninna Beauty sur Render

Application Node.js de prise de rendez-vous. Aucune configuration secrète requise
pour démarrer — tout se gère ensuite dans l'interface admin de l'app.

## Option A — Fork + Blueprint (recommandé : déploiement auto à chaque mise à jour)

1. Forker ce dépôt sur ton compte GitHub (bouton « Fork »)
2. Sur Render : **New + → Blueprint** → sélectionner le fork
3. Render lit `render.yaml` et crée tout automatiquement (service web + disque persistant) → **Apply**

## Option B — URL publique directe (sans fork)

1. Sur Render : **New + → Web Service → Public Git Repository**
2. Coller : `https://github.com/ilyeshamrouni2007-eng/ninna-beauty`
3. Paramètres :
   - Runtime : **Node**
   - Build command : `npm install`
   - Start command : `npm start`
   - Plan : **Starter** (nécessaire pour le disque)
4. ⚠️ **Indispensable — ajouter un disque persistant** (sinon les rendez-vous sont
   effacés à chaque redéploiement) : section **Disks → Add Disk**
   - Mount path : `/opt/render/project/src/data`
   - Taille : 1 GB
5. **Create Web Service**

## Après le déploiement

- L'URL publique (ex. `https://ninna-beauty.onrender.com`) est le site de réservation
- L'espace admin est sur `/admin` — mot de passe initial : `ninna`
  (**à changer immédiatement** dans Paramètres)
- Notifications réelles (email/WhatsApp) : plus tard, ajouter les variables
  d'environnement `SMTP_*` et `TWILIO_*` dans l'onglet **Environment** du service
  (voir `.env.example` pour la liste)

## Vérification rapide

Ouvrir l'URL : le calendrier doit afficher des créneaux disponibles.
Ouvrir `/admin`, se connecter, onglet Notifications : vide au départ, c'est normal.
