# Ninna Beauty — Application de réservation

Application web de prise de rendez-vous pour l'institut de pose d'ongles Ninna Beauty.
Thème « Rose ballerine » : rose poudré, formes arrondies, typographie serif élégante.

## Démarrer l'application

```bash
cd ninna-beauty
npm install        # une seule fois
npm start          # puis ouvrir http://localhost:3178
```

- Site clientes : `http://localhost:3178`
- Espace pro : `http://localhost:3178/admin` — mot de passe par défaut : **ninna**
  (à changer dès la première connexion dans Paramètres)

## Côté clientes

1. Calendrier interactif : seuls les jours avec des créneaux libres sont cliquables
2. Choix de l'horaire, puis de la pose (avec description, durée et prix)
3. Récapitulatif + saisie prénom/nom, téléphone, email
4. Confirmation à l'écran + email de confirmation avec un code d'annulation
5. Annulation possible depuis le lien « Annuler un rendez-vous » avec ce code

## Côté admin (espace pro)

- **Rendez-vous** : liste des rendez-vous à venir (et passés/annulés), annulation possible
- **Disponibilités** : semaine type (2 plages par jour, ex. matin/après-midi) + gestion jour par jour (fermer une journée, bloquer/débloquer un créneau précis)
- **Prestations** : ajouter, modifier (nom, prix, durée, description), masquer ou supprimer
- **Notifications** : historique de tous les messages envoyés (email/WhatsApp)
- **Paramètres** : nom de l'institut, durée des créneaux, email et numéro WhatsApp de notification, mot de passe

## Notifications (email + WhatsApp)

Par défaut l'application est en **mode simulation** : chaque notification est
enregistrée dans l'onglet Notifications de l'espace pro, mais rien n'est
réellement envoyé. Pour activer les envois réels :

1. Copier `.env.example` en `.env`
2. **Email** : remplir les variables `SMTP_*` (Gmail avec mot de passe d'application, Brevo, OVH…)
3. **WhatsApp** : créer un compte [Twilio](https://www.twilio.com) avec l'API WhatsApp et remplir les variables `TWILIO_*`
4. Redémarrer le serveur, puis renseigner dans Paramètres l'email et le numéro WhatsApp de la patronne

## Mettre en ligne (lien public)

L'application est un simple serveur Node.js : elle se déploie en quelques minutes
sur Render, Railway ou Fly.io (offres gratuites disponibles) :

- Commande de démarrage : `npm start`
- Le port est fourni via la variable d'environnement `PORT` (déjà géré)
- Les données sont stockées dans `data/db.json` — prévoir un disque persistant
  (Render : « Persistent Disk » monté sur `data/`)

## Structure

```
server.js          Serveur Express + API + notifications (email/WhatsApp)
public/index.html  Site de réservation clientes
public/admin.html  Espace pro
data/db.json       Base de données (créée automatiquement)
.env.example       Modèle de configuration des envois réels
```

## Logo

`public/assets/logo.svg` est une recréation approchée du logo. Pour utiliser
l'original, déposer le fichier dans `public/assets/` et mettre à jour les
balises `<img>` de `index.html` et `admin.html` si le nom diffère.
