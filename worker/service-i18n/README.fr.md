# Package de service d'inférence

Généré par Wulabel. Il récupère les flux vidéo des caméras, les analyse avec le modèle entraîné et envoie une alerte dès qu'une cible est détectée. Il fournit aussi une API HTTP de détection.

## Exécution

Nécessite Python 3.9 ou plus récent (ni PyTorch ni carte graphique ne sont nécessaires).

- Windows : double-cliquez sur `run.bat`
- Linux : `sh run.sh`

Au premier lancement, un environnement Python est créé automatiquement et onnxruntime, opencv et numpy sont installés (environ 100 Mo). Ensuite, le service démarre directement.

Pour l'inférence sur un GPU NVIDIA : remplacez `onnxruntime` par `onnxruntime-gpu` dans `requirements.txt`, supprimez le dossier `venv` puis relancez.

## Configuration : config.json

```jsonc
{
  "model": "model.onnx",
  "gpu": true,                 // utilise le GPU si onnxruntime-gpu est installé
  "max_side": 1280,            // réduit le grand côté de chaque image à cette taille avant détection ; plus petit = plus rapide
  "port": 8090,                // port de l'API HTTP
  "interval": 1.0,             // analyse une image toutes les N secondes pour chaque flux
  "streams": [
    {
      "name": "Porte nord",
      "url": "rtsp://admin:motdepasse@192.168.1.64:554/Streaming/Channels/101",
      "region": [[0.1, 0.4], [0.9, 0.4], [0.9, 1.0], [0.1, 1.0]]  // facultatif : zone de détection, coordonnées en proportions 0–1
    }
  ],
  "alert": {
    "labels": ["sans_casque"],  // n'alerter que pour ces classes ; vide = toutes les classes
    "min_score": 0.5,          // seuil de confiance
    "cooldown": 60,            // au plus une alerte toutes les N secondes pour un même flux et une même classe
    "hours": "07:00-19:00",    // plage horaire active ; vide = toute la journée ; à cheval sur minuit, écrire "22:00-06:00"
    "save_image": true         // enregistre les captures d'alerte dans alerts/
  },
  "webhook": { "url": "http://votre-plateforme/api/alarm", "with_image": false, "headers": {} },
  "mqtt": { "host": "", "port": 1883, "topic": "xlabel/alarm", "username": "", "password": "" },
  "reflux": { "enabled": true, "low": 0.3, "high": 0.5, "interval": 60 }
}
```

- Une source peut aussi être le chemin d'un fichier vidéo local, pour les tests (lu en boucle par défaut).
- La zone de détection est évaluée sur le **milieu du bord inférieur** de chaque boîte (là où se tient la personne ou le véhicule).

## Contenu de l'alerte

Message envoyé au Webhook (POST JSON) et via MQTT :

```json
{
  "stream": "Porte nord",
  "time": "2026-11-01T08:30:15",
  "labels": ["sans_casque"],
  "detections": [{ "label": "sans_casque", "score": 0.91, "box": [x, y, w, h] }],
  "width": 1920,
  "height": 1080,
  "image": "alerts/20261101/Porte nord_083015.jpg"
}
```

Si `with_image` est activé pour le Webhook, un champ `image_base64` supplémentaire est ajouté (JPEG avec les boîtes dessinées).

## API HTTP

| Point d'accès | Description |
|---|---|
| `GET /health` | État du service et disponibilité de chaque flux |
| `GET /alerts?limit=50` | Alertes récentes |
| `GET /alerts/20261101/xxx.jpg` | Capture d'une alerte |
| `POST /predict?conf=0.4` | Envoie une image (fichier image brut dans le corps de la requête, ou JSON `{"image": "base64"}`) et renvoie les détections |

```bash
curl -X POST --data-binary @test.jpg "http://127.0.0.1:8090/predict?conf=0.4"
```

## Retour du terrain

Les images sur lesquelles le modèle hésite (confiance entre `low` et `high`) sont enregistrées dans `reflux/` (au plus une par flux toutes les `interval` secondes).
Rapatriez régulièrement le dossier `reflux`, cliquez sur « Importer des images remontées du terrain » dans la page « Déploiement » de Wulabel, annotez-les et réentraînez : plus vous l'utilisez, plus le modèle devient précis.

## Fichiers

```
model.onnx / model.json   modèle et classes
service.py                programme du service
config.json               configuration
alerts/                   captures d'alerte
reflux/                   images du terrain
logs/service.log          journal
```
